import { once } from "node:events"
import { createServer, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"
import pino from "pino"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import WebSocket from "ws"

import { DEFAULT_LIMITS } from "../constants"
import type { RealtimeLimits, RealtimeOptions } from "../types"

import { attachRealtimeServer } from "."

const access = {
  authenticate: () => ({ id: "reader" }),
  authorizeSubscription: () => true,
}

type Options = Omit<RealtimeOptions<{ id: string }>, "server" | "path" | "logger"> & {
  logger?: RealtimeOptions<unknown>["logger"]
}

async function openServer(options: Options = {}) {
  const server = createServer((_request, response) => response.end("healthy"))
  const realtime = attachRealtimeServer({
    ...options,
    server,
    path: "/realtime",
    logger: options.logger ?? pino({ level: "silent" }),
  })
  const sockets: WebSocket[] = []

  onTestFinished(async () => {
    for (const socket of sockets) socket.terminate()
    await realtime.close()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  const url = `ws://127.0.0.1:${port}/realtime`

  function client(clientOptions: WebSocket.ClientOptions = {}, target = url) {
    const socket = new WebSocket(target, clientOptions)
    socket.on("error", () => {})
    sockets.push(socket)
    return socket
  }

  async function connect(clientOptions?: WebSocket.ClientOptions) {
    const socket = client(clientOptions)
    await once(socket, "open")
    return socket
  }

  return { server, realtime, url, client, connect }
}

async function message(socket: WebSocket, value: unknown) {
  const received = once(socket, "message") as Promise<[Buffer]>
  socket.send(JSON.stringify(value))
  const [data] = await received
  return JSON.parse(String(data)) as unknown
}

async function rejected(socket: WebSocket) {
  const [, response] = (await once(socket, "unexpected-response")) as [unknown, IncomingMessage]
  response.resume()
  socket.terminate()
  return response.statusCode as number
}

function parseMessage(data: WebSocket.RawData): unknown {
  return JSON.parse((data as Buffer).toString())
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe("attachRealtimeServer()", () => {
  it.each([
    { name: "no access policy", options: {}, status: 403 },
    {
      name: "no authentication callback",
      options: { authorizeSubscription: () => true },
      status: 403,
    },
    {
      name: "no authorization callback",
      options: { authenticate: access.authenticate },
      status: 403,
    },
    {
      name: "an unauthenticated identity",
      options: { ...access, authenticate: () => null },
      status: 401,
    },
  ])("rejects $name before upgrading", async ({ options, status }) => {
    const hub = await openServer(options)

    expect(await rejected(hub.client())).toBe(status)
  })

  it("summarizes repeated upgrade rejections without amplifying logs or exposing request data", async () => {
    const records: unknown[] = []
    const hub = await openServer({
      logger: pino(
        { level: "trace" },
        { write: (line) => records.push(JSON.parse(line) as unknown) },
      ),
    })

    for (let attempt = 0; attempt < 3; attempt++) {
      expect(
        await rejected(
          hub.client(
            { headers: { authorization: "Bearer rejection-header-marker" } },
            `${hub.url}?token=rejection-query-marker`,
          ),
        ),
      ).toBe(403)
    }

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ level: 40, statusCode: 403 })
    await hub.realtime.close()
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ level: 40, statusCode: 403, count: 2 })
    expect(JSON.stringify(records)).not.toMatch(/rejection-header-marker|rejection-query-marker/)
  })

  it("authenticates the upgrade and denies channels without subscribing them", async () => {
    const authorizeSubscription = vi.fn((identity: { id: string }, channel: string) =>
      Promise.resolve(identity.id === "reader" && channel === "allowed"),
    )
    const hub = await openServer({ ...access, authorizeSubscription })
    const socket = await hub.connect()
    const received: unknown[] = []
    socket.on("message", (data) => received.push(parseMessage(data)))

    expect(await message(socket, { type: "subscribe", channel: "private" })).toEqual({
      type: "error",
      code: "FORBIDDEN",
    })
    hub.realtime.broadcast("private", { type: "secret", payload: "not delivered" })
    expect(await message(socket, { type: "subscribe", channel: "allowed" })).toEqual({
      type: "subscribed",
      channel: "allowed",
    })

    expect(authorizeSubscription.mock.calls[0]?.slice(0, 2)).toEqual([{ id: "reader" }, "private"])
    expect(received).toEqual([
      { type: "error", code: "FORBIDDEN" },
      { type: "subscribed", channel: "allowed" },
    ])
  })

  it("delivers only to current channel members and keeps server instances isolated", async () => {
    const first = await openServer(access)
    const second = await openServer(access)
    const member = await first.connect()
    const outsider = await first.connect()
    const otherInstance = await second.connect()
    await message(member, { type: "subscribe", channel: "build:one" })
    await message(otherInstance, { type: "subscribe", channel: "build:one" })
    const outsiderMessages: unknown[] = []
    const otherMessages: unknown[] = []
    outsider.on("message", (data) => outsiderMessages.push(parseMessage(data)))
    otherInstance.on("message", (data) => otherMessages.push(parseMessage(data)))
    const delivery = once(member, "message") as Promise<[Buffer]>

    first.realtime.broadcast("build:one", {
      type: "updated",
      payload: { count: 1, values: [null, true, "ready"] },
    })

    const [data] = await delivery
    expect(JSON.parse(String(data))).toEqual({
      type: "event",
      channel: "build:one",
      event: { type: "updated", payload: { count: 1, values: [null, true, "ready"] } },
    })
    await message(outsider, { type: "unsubscribe", channel: "build:one" })
    await message(otherInstance, { type: "unsubscribe", channel: "build:one" })
    expect(outsiderMessages).toEqual([{ type: "unsubscribed", channel: "build:one" }])
    expect(otherMessages).toEqual([{ type: "unsubscribed", channel: "build:one" }])
  })

  it("does not replay events sent before subscription", async () => {
    const hub = await openServer(access)
    hub.realtime.broadcast("build:one", { type: "past", payload: null })
    const socket = await hub.connect()
    const received: unknown[] = []
    socket.on("message", (data) => received.push(parseMessage(data)))

    await message(socket, { type: "subscribe", channel: "build:one" })
    const delivery = once(socket, "message")
    hub.realtime.broadcast("build:one", { type: "current", payload: null })
    await delivery

    expect(received).toEqual([
      { type: "subscribed", channel: "build:one" },
      { type: "event", channel: "build:one", event: { type: "current", payload: null } },
    ])
  })

  it("makes repeated subscriptions and removals idempotent and releases subscription capacity", async () => {
    const hub = await openServer({ ...access, limits: { maxSubscriptionsPerConnection: 1 } })
    const socket = await hub.connect()

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await message(socket, { type: "subscribe", channel: "one" })).toEqual({
        type: "subscribed",
        channel: "one",
      })
    }
    expect(await message(socket, { type: "subscribe", channel: "two" })).toEqual({
      type: "error",
      code: "SUBSCRIPTION_LIMIT",
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await message(socket, { type: "unsubscribe", channel: "one" })).toEqual({
        type: "unsubscribed",
        channel: "one",
      })
    }
    await message(socket, { type: "subscribe", channel: "two" })
    const received: unknown[] = []
    socket.on("message", (data) => received.push(parseMessage(data)))
    const delivery = once(socket, "message")
    hub.realtime.broadcast("one", { type: "removed", payload: null })
    hub.realtime.broadcast("two", { type: "active", payload: null })
    await delivery
    expect(received).toEqual([
      { type: "event", channel: "two", event: { type: "active", payload: null } },
    ])
  })

  it.each([
    { name: "malformed JSON", data: "{" },
    { name: "an array", data: "[]" },
    {
      name: "a binary command",
      data: Buffer.from('{"type":"subscribe","channel":"one"}'),
    },
    { name: "a client publish command", data: '{"type":"publish","channel":"one"}' },
    { name: "a channel with a leading separator", data: '{"type":"subscribe","channel":":one"}' },
    { name: "a non-ASCII channel", data: '{"type":"subscribe","channel":"café"}' },
    { name: "an empty channel", data: '{"type":"subscribe","channel":""}' },
    {
      name: "an oversized channel",
      data: JSON.stringify({ type: "subscribe", channel: "a".repeat(201) }),
    },
  ])("rejects $name while keeping the connection usable", async ({ data }) => {
    const hub = await openServer(access)
    const socket = await hub.connect()
    const received = once(socket, "message") as Promise<[Buffer]>
    socket.send(data)
    const [response] = await received

    expect(JSON.parse(String(response))).toEqual({ type: "error", code: "INVALID_MESSAGE" })
    expect(await message(socket, { type: "subscribe", channel: "valid:._/-1" })).toEqual({
      type: "subscribed",
      channel: "valid:._/-1",
    })
  })

  it("accepts a channel at the maximum length", async () => {
    const hub = await openServer(access)
    const socket = await hub.connect()
    const channel = "a".repeat(200)

    expect(await message(socket, { type: "subscribe", channel })).toEqual({
      type: "subscribed",
      channel,
    })
  })

  it("closes instead of accumulating messages while authorization is pending", async () => {
    const decision = deferred<boolean>()
    const authorizeSubscription = vi.fn(() => decision.promise)
    const hub = await openServer({ ...access, authorizeSubscription })
    const socket = await hub.connect()
    socket.send(JSON.stringify({ type: "subscribe", channel: "one" }))
    await vi.waitFor(() => expect(authorizeSubscription).toHaveBeenCalledTimes(1))
    const closed = once(socket, "close") as Promise<[number]>

    socket.send(JSON.stringify({ type: "unsubscribe", channel: "one" }))
    const [code] = await closed
    decision.resolve(true)

    expect(code).toBe(1008)
    expect(authorizeSubscription).toHaveBeenCalledTimes(1)
  })

  it("times out subscription checks and retains their capacity until they settle", async () => {
    const decision = deferred<boolean>()
    const authorizeSubscription = vi
      .fn<NonNullable<Options["authorizeSubscription"]>>()
      .mockImplementationOnce(() => decision.promise)
      .mockResolvedValue(true)
    const hub = await openServer({
      ...access,
      authorizeSubscription,
      limits: { maxConnections: 1, upgradeTimeoutMs: 40 },
    })
    const socket = await hub.connect()
    const closed = once(socket, "close") as Promise<[number]>
    socket.send(JSON.stringify({ type: "subscribe", channel: "one" }))

    const [code] = await closed
    expect(code).toBe(1008)
    expect(authorizeSubscription.mock.calls[0]?.[2].aborted).toBe(true)
    expect(await rejected(hub.client())).toBe(503)
    decision.resolve(true)
    const replacement = await hub.connect()
    expect(await message(replacement, { type: "subscribe", channel: "one" })).toEqual({
      type: "subscribed",
      channel: "one",
    })
  })

  it("closes safely when subscription authorization fails without logging its exception", async () => {
    const logs: string[] = []
    const hub = await openServer({
      ...access,
      logger: pino({ level: "trace" }, { write: (line) => logs.push(line) }),
      authorizeSubscription: () => Promise.reject(new Error("private-authorization-secret")),
    })
    const socket = await hub.connect()
    const closed = once(socket, "close") as Promise<[number]>

    socket.send(JSON.stringify({ type: "subscribe", channel: "private-channel-secret" }))
    const [code] = await closed

    expect(code).toBe(1011)
    expect(logs.join("")).not.toMatch(/private-authorization-secret|private-channel-secret/)
  })

  it("reserves global connection capacity before authentication completes", async () => {
    const identity = deferred<{ id: string } | null>()
    const authenticate = vi.fn(() => identity.promise)
    const hub = await openServer({ ...access, authenticate, limits: { maxConnections: 1 } })
    const pending = hub.client()
    const opened = once(pending, "open")
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1))

    expect(await rejected(hub.client())).toBe(503)
    identity.resolve({ id: "reader" })
    await opened
    expect(authenticate).toHaveBeenCalledTimes(1)
  })

  it("limits the direct peer address without trusting forwarded addresses", async () => {
    const hub = await openServer({ ...access, limits: { maxConnectionsPerAddress: 1 } })
    const first = await hub.connect({ headers: { "x-forwarded-for": "192.0.2.1" } })

    expect(await rejected(hub.client({ headers: { "x-forwarded-for": "192.0.2.2" } }))).toBe(429)
    const closed = once(first, "close")
    first.close()
    await closed
    const replacement = await hub.connect()
    expect(replacement.readyState).toBe(WebSocket.OPEN)
  })

  it("bounds tracked addresses, retains active entries, and reclaims expired inactive entries", async () => {
    const hub = await openServer({ ...access, limits: { maxTrackedAddresses: 1 } })
    let counter = 0
    let firstTransportClosed = Promise.resolve()
    function substitutePeer(request: IncomingMessage) {
      Object.defineProperty(request.socket, "remoteAddress", {
        value: `192.0.2.${++counter}`,
      })
      if (counter === 1) {
        firstTransportClosed = once(request.socket, "close").then(() => {})
      }
    }
    hub.server.prependListener("upgrade", substitutePeer)
    onTestFinished(() => {
      hub.server.off("upgrade", substitutePeer)
    })
    const first = await hub.connect()

    expect(await rejected(hub.client())).toBe(503)
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001)
    expect(await rejected(hub.client())).toBe(503)
    const closed = once(first, "close")
    first.close()
    await closed
    await firstTransportClosed
    const replacement = await hub.connect()

    expect(replacement.readyState).toBe(WebSocket.OPEN)
  })

  it("bounds upgrade attempts even when authentication denies every request", async () => {
    const authenticate = vi.fn(() => null)
    const hub = await openServer({
      ...access,
      authenticate,
      limits: { maxUpgradeAttemptsPerMinute: 2 },
    })

    expect(await rejected(hub.client())).toBe(401)
    expect(await rejected(hub.client())).toBe(401)
    expect(await rejected(hub.client())).toBe(429)
    expect(authenticate).toHaveBeenCalledTimes(2)
  })

  it("times out authentication but bounds unresolved checks until they settle", async () => {
    const identity = deferred<{ id: string } | null>()
    const authenticate = vi
      .fn<NonNullable<Options["authenticate"]>>()
      .mockImplementationOnce(() => identity.promise)
      .mockReturnValue({ id: "reader" })
    const hub = await openServer({
      ...access,
      authenticate,
      limits: { maxConnections: 1, upgradeTimeoutMs: 40 },
    })

    expect(await rejected(hub.client())).toBe(408)
    expect(authenticate.mock.calls[0]?.[1].aborted).toBe(true)
    expect(await rejected(hub.client())).toBe(503)
    identity.resolve({ id: "reader" })
    const replacement = await hub.connect()
    expect(replacement.readyState).toBe(WebSocket.OPEN)
  })

  it("rejects failed authentication without logging request or exception secrets", async () => {
    const logs: string[] = []
    const logger = pino({ level: "trace" }, { write: (line) => logs.push(line) })
    const hub = await openServer({
      ...access,
      logger,
      authenticate: () => Promise.reject(new Error("private-exception-secret")),
    })

    expect(
      await rejected(
        hub.client(
          { headers: { authorization: "Bearer request-header-marker" } },
          `${hub.url}?token=private-query-secret`,
        ),
      ),
    ).toBe(500)
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.join("")).not.toMatch(
      /private-exception-secret|request-header-marker|private-query-secret/,
    )
  })

  it("closes oversized inbound messages with the protocol size code", async () => {
    const hub = await openServer({ ...access, limits: { maxMessageBytes: 64 } })
    const socket = await hub.connect()
    const closed = once(socket, "close") as Promise<[number]>

    socket.send("a".repeat(65))

    const [code] = await closed
    expect(code).toBe(1009)
  })

  it("bounds message fragment overhead even when the payload is small", async () => {
    const hub = await openServer(access)
    const socket = await hub.connect()
    const closed = once(socket, "close") as Promise<[number]>
    const received = once(socket, "message")
    const outcome = Promise.race([
      closed.then(([code]) => code),
      received.then(() => "unexpected application response"),
    ])

    for (let fragment = 0; fragment < 129; fragment++) {
      socket.send(" ", { fin: false })
    }
    socket.send("null", { fin: true })

    expect(await outcome).toBe(1008)
  })

  it("rejects oversized broadcasts synchronously without disconnecting a healthy member", async () => {
    const hub = await openServer({ ...access, limits: { maxMessageBytes: 128 } })
    const socket = await hub.connect()
    await message(socket, { type: "subscribe", channel: "one" })

    expect(() =>
      hub.realtime.broadcast("one", { type: "large", payload: "a".repeat(128) }),
    ).toThrow(RangeError)
    const delivery = once(socket, "message") as Promise<[Buffer]>
    hub.realtime.broadcast("one", { type: "small", payload: null })
    const [data] = await delivery
    expect(JSON.parse(String(data))).toMatchObject({ event: { type: "small" } })
  })

  it.each([
    { channel: "", type: "updated" },
    { channel: "one", type: "" },
    { channel: "one", type: "a".repeat(101) },
  ])("rejects invalid outbound channel or event names", async ({ channel, type }) => {
    const hub = await openServer(access)

    expect(() => hub.realtime.broadcast(channel, { type, payload: null })).toThrow()
  })

  it("rejects non-finite outbound JSON numbers instead of silently publishing null", async () => {
    const hub = await openServer(access)

    expect(() =>
      hub.realtime.broadcast("one", { type: "updated", payload: { count: Number.NaN } }),
    ).toThrow()
  })

  it("answers a client ping with the same pong payload", async () => {
    const hub = await openServer(access)
    const socket = await hub.connect()
    const received = once(socket, "pong") as Promise<[Buffer]>
    const payload = Buffer.from("keepalive")

    socket.ping(payload)

    const [response] = await received
    expect(response).toEqual(payload)
  })

  it.each(["ping", "pong"] as const)(
    "counts incoming %s frames against the message rate",
    async (frame) => {
      const hub = await openServer({ ...access, limits: { maxMessagesPerSecond: 1 } })
      const socket = await hub.connect()
      const closed = once(socket, "close") as Promise<[number]>
      const received = once(socket, "message")
      const outcome = Promise.race([
        closed.then(([code]) => code),
        received.then(() => "unexpected application response"),
      ])

      socket[frame]("one")
      socket[frame]("two")
      socket.send(JSON.stringify({ type: "subscribe", channel: "one" }))

      expect(await outcome).toBe(1008)
    },
  )

  it("terminates before a pong would exceed the send buffer budget", async () => {
    const hub = await openServer({ ...access, limits: { maxBufferedBytes: 8 } })
    const socket = await hub.connect()
    const pongs: Buffer[] = []
    socket.on("pong", (data) => pongs.push(data))
    const closed = once(socket, "close") as Promise<[number]>
    const received = once(socket, "pong")
    const outcome = Promise.race([
      closed.then(([code]) => code),
      received.then(() => "unexpected pong"),
    ])

    socket.ping(Buffer.alloc(16, "a"))

    expect(await outcome).toBe(1006)
    expect(pongs).toEqual([])
  })

  it("closes a connection that exceeds its message rate", async () => {
    const hub = await openServer({ ...access, limits: { maxMessagesPerSecond: 1 } })
    const socket = await hub.connect()
    await message(socket, { type: "subscribe", channel: "one" })
    const closed = once(socket, "close") as Promise<[number]>

    socket.send(JSON.stringify({ type: "unsubscribe", channel: "one" }))

    const [code] = await closed
    expect(code).toBe(1008)
  })

  it("terminates a member before a delivery would exceed its send buffer budget", async () => {
    const hub = await openServer({ ...access, limits: { maxBufferedBytes: 128 } })
    const socket = await hub.connect()
    await message(socket, { type: "subscribe", channel: "one" })
    const closed = once(socket, "close") as Promise<[number]>

    hub.realtime.broadcast("one", { type: "updated", payload: "a".repeat(128) })

    const [code] = await closed
    expect(code).toBe(1006)
  })

  it("includes WebSocket framing in the outgoing byte budget", async () => {
    const event = { type: "updated", payload: "a".repeat(60) }
    const bytes = Buffer.byteLength(JSON.stringify({ type: "event", channel: "one", event }))
    const hub = await openServer({ ...access, limits: { maxBufferedBytes: bytes } })
    const socket = await hub.connect()
    await message(socket, { type: "subscribe", channel: "one" })
    const closed = once(socket, "close") as Promise<[number]>

    hub.realtime.broadcast("one", event)

    const [code] = await closed
    expect(code).toBe(1006)
  })

  it("terminates clients that do not answer heartbeats but keeps responsive clients", async () => {
    const hub = await openServer({ ...access, limits: { heartbeatIntervalMs: 40 } })
    const responsive = await hub.connect()
    const unresponsive = await hub.connect({ autoPong: false })
    const closed = once(unresponsive, "close") as Promise<[number]>

    const [code] = await closed

    expect(code).toBe(1006)
    expect(responsive.readyState).toBe(WebSocket.OPEN)
    expect(await message(responsive, { type: "subscribe", channel: "one" })).toEqual({
      type: "subscribed",
      channel: "one",
    })
  })

  it("shares one close promise, closes clients, removes its listener, and leaves HTTP serving", async () => {
    const hub = await openServer(access)
    const socket = await hub.connect()
    const closed = once(socket, "close") as Promise<[number]>

    const shutdown = hub.realtime.close()
    expect(hub.realtime.close()).toBe(shutdown)
    const [code] = await closed
    await shutdown

    expect(code).toBe(1001)
    expect(hub.server.listenerCount("upgrade")).toBe(0)
    expect(() => hub.realtime.broadcast("one", { type: "updated", payload: null })).toThrow()
    const response = await fetch(hub.url.replace("ws:", "http:"))
    expect(await response.text()).toBe("healthy")
  })

  it("closes pending handshakes without waiting for authentication to settle", async () => {
    const identity = deferred<{ id: string } | null>()
    const authenticate = vi.fn(() => identity.promise)
    const hub = await openServer({ ...access, authenticate, limits: { shutdownTimeoutMs: 40 } })
    const pending = hub.client()
    const closed = new Promise<void>((resolve) => {
      pending.once("close", () => resolve())
      pending.once("unexpected-response", (_request, response) => {
        response.resume()
        pending.terminate()
        resolve()
      })
    })
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1))

    await hub.realtime.close()
    await closed
    identity.resolve({ id: "reader" })

    expect(pending.readyState).not.toBe(WebSocket.OPEN)
  })

  it("finishes shutdown when a client never processes the closing handshake", async () => {
    const hub = await openServer({ ...access, limits: { shutdownTimeoutMs: 40 } })
    const socket = await hub.connect()
    socket.pause()
    const closed = once(socket, "close")

    await hub.realtime.close()
    socket.resume()
    await closed

    expect(socket.readyState).toBe(WebSocket.CLOSED)
  })

  it.each(Object.keys(DEFAULT_LIMITS) as (keyof RealtimeLimits)[])(
    "validates the %s limit at construction",
    (key) => {
      const server = createServer()
      for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
        expect(() =>
          attachRealtimeServer({
            server,
            path: "/realtime",
            logger: pino({ level: "silent" }),
            limits: { [key]: value },
          }),
        ).toThrow()
      }
      expect(server.listenerCount("upgrade")).toBe(0)
    },
  )
})
