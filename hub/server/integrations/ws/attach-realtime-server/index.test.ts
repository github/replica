import { once } from "node:events"
import { describe, expect, it, vi } from "vitest"
import WebSocket from "ws"

import { deferred } from "../../../../test/ws/deferred"
import { openServer } from "../../../../test/ws/open-server"
import { parseMessage } from "../../../../test/ws/parse-message"
import { rejected } from "../../../../test/ws/rejected"
import { sendMessage } from "../../../../test/ws/send-message"

import type { RealtimeOptions } from "../types"

describe("attachRealtimeServer()", () => {
  it("rejects upgrades when no access policy is configured", async () => {
    const hub = await openServer()

    expect(await rejected(hub.client())).toBe(403)
  })

  it("rejects unauthenticated callers before upgrading", async () => {
    const hub = await openServer({
      authenticate: () => null,
      authorizeSubscription: () => true,
    })

    expect(await rejected(hub.client())).toBe(401)
  })

  it("passes the caller's identity to authorization and never subscribes denied channels", async () => {
    const authorizeSubscription = vi.fn((identity: string, channel: string) =>
      Promise.resolve(identity === "reader" && channel === "allowed"),
    )
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription,
    })
    const socket = await hub.connect()
    const received: unknown[] = []
    socket.on("message", (data) => received.push(parseMessage(data)))

    expect(await sendMessage(socket, { type: "subscribe", channel: "private" })).toEqual({
      type: "error",
      code: "FORBIDDEN",
    })
    hub.realtime.broadcast("private", { type: "secret", payload: "not delivered" })
    await sendMessage(socket, { type: "subscribe", channel: "allowed" })

    expect(authorizeSubscription.mock.calls[0]?.slice(0, 2)).toEqual(["reader", "private"])
    expect(received).toEqual([
      { type: "error", code: "FORBIDDEN" },
      { type: "subscribed", channel: "allowed" },
    ])
  })

  it("delivers only to current subscribers and releases their subscription capacity", async () => {
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription: () => true,
      limits: { maxSubscriptionsPerConnection: 1 },
    })
    const member = await hub.connect()
    const outsider = await hub.connect()
    const received: unknown[] = []
    outsider.on("message", (data) => received.push(parseMessage(data)))
    expect(await sendMessage(member, { type: "subscribe", channel: "one" })).toEqual({
      type: "subscribed",
      channel: "one",
    })
    expect(await sendMessage(member, { type: "subscribe", channel: "two" })).toEqual({
      type: "error",
      code: "SUBSCRIPTION_LIMIT",
    })
    const delivery = once(member, "message") as Promise<[Buffer]>
    const event = { type: "updated", payload: { count: 1 } }

    hub.realtime.broadcast("one", event)

    const [data] = await delivery
    expect(JSON.parse(String(data))).toEqual({ type: "event", channel: "one", event })
    expect(await sendMessage(member, { type: "unsubscribe", channel: "one" })).toEqual({
      type: "unsubscribed",
      channel: "one",
    })
    expect(await sendMessage(member, { type: "subscribe", channel: "two" })).toEqual({
      type: "subscribed",
      channel: "two",
    })
    const remaining: unknown[] = []
    member.on("message", (message) => remaining.push(parseMessage(message)))
    const nextDelivery = once(member, "message")
    hub.realtime.broadcast("one", { type: "removed", payload: null })
    hub.realtime.broadcast("two", event)
    await nextDelivery
    await sendMessage(outsider, { type: "unsubscribe", channel: "one" })

    expect(remaining).toEqual([{ type: "event", channel: "two", event }])
    expect(received).toEqual([{ type: "unsubscribed", channel: "one" }])
  })

  it("rejects malformed JSON without making the connection unusable", async () => {
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription: () => true,
    })
    const socket = await hub.connect()
    const received = once(socket, "message") as Promise<[Buffer]>

    socket.send("{")

    const [data] = await received
    expect(JSON.parse(String(data))).toEqual({ type: "error", code: "INVALID_MESSAGE" })
    expect(await sendMessage(socket, { type: "subscribe", channel: "one" })).toEqual({
      type: "subscribed",
      channel: "one",
    })
  })

  it("reserves capacity during authentication and retains it after timeout until the check settles", async () => {
    const identity = deferred<string | null>()
    const authenticate = vi.fn<NonNullable<RealtimeOptions<string>["authenticate"]>>(
      () => identity.promise,
    )
    const hub = await openServer({
      authenticate,
      authorizeSubscription: () => true,
      limits: { maxConnections: 1, upgradeTimeoutMs: 100 },
    })
    const pending = rejected(hub.client())
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1))

    expect(await rejected(hub.client())).toBe(503)
    expect(await pending).toBe(408)
    expect(authenticate.mock.calls[0]?.[1].aborted).toBe(true)
    expect(await rejected(hub.client())).toBe(503)
    identity.resolve("reader")
    const replacement = await hub.connect()
    expect(replacement.readyState).toBe(WebSocket.OPEN)
  })

  it("times out subscription checks and retains their capacity until they settle", async () => {
    const decision = deferred<boolean>()
    const authorizeSubscription = vi
      .fn<NonNullable<RealtimeOptions<string>["authorizeSubscription"]>>()
      .mockImplementationOnce(() => decision.promise)
      .mockResolvedValue(true)
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription,
      limits: { maxConnections: 1, upgradeTimeoutMs: 100 },
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
    expect(await sendMessage(replacement, { type: "subscribe", channel: "one" })).toEqual({
      type: "subscribed",
      channel: "one",
    })
  })

  it("limits the direct peer address without trusting forwarded addresses", async () => {
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription: () => true,
      limits: { maxConnectionsPerAddress: 1 },
    })
    const first = await hub.connect({ headers: { "x-forwarded-for": "192.0.2.1" } })

    expect(await rejected(hub.client({ headers: { "x-forwarded-for": "192.0.2.2" } }))).toBe(429)
    const closed = once(first, "close")
    first.close()
    await closed
    expect((await hub.connect()).readyState).toBe(WebSocket.OPEN)
  })

  it("bounds upgrade attempts even when authentication denies every request", async () => {
    const authenticate = vi.fn(() => null)
    const hub = await openServer({
      authenticate,
      authorizeSubscription: () => true,
      limits: { maxUpgradeAttemptsPerMinute: 2 },
    })

    expect(await rejected(hub.client())).toBe(401)
    expect(await rejected(hub.client())).toBe(401)
    expect(await rejected(hub.client())).toBe(429)
    expect(authenticate).toHaveBeenCalledTimes(2)
  })

  it("closes oversized inbound messages with the protocol size code", async () => {
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription: () => true,
      limits: { maxMessageBytes: 64 },
    })
    const socket = await hub.connect()
    const closed = once(socket, "close") as Promise<[number]>

    socket.send("a".repeat(65))

    const [code] = await closed
    expect(code).toBe(1009)
  })

  it("rejects oversized broadcasts without disconnecting a healthy member", async () => {
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription: () => true,
      limits: { maxMessageBytes: 128 },
    })
    const socket = await hub.connect()
    await sendMessage(socket, { type: "subscribe", channel: "one" })

    expect(() =>
      hub.realtime.broadcast("one", { type: "large", payload: "a".repeat(128) }),
    ).toThrow(RangeError)
    const delivery = once(socket, "message") as Promise<[Buffer]>
    hub.realtime.broadcast("one", { type: "small", payload: null })
    const [data] = await delivery
    expect(JSON.parse(String(data))).toMatchObject({ event: { type: "small" } })
  })

  it("closes a connection that exceeds its message rate", async () => {
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription: () => true,
      limits: { maxMessagesPerSecond: 1 },
    })
    const socket = await hub.connect()
    await sendMessage(socket, { type: "subscribe", channel: "one" })
    const closed = once(socket, "close") as Promise<[number]>

    socket.send(JSON.stringify({ type: "unsubscribe", channel: "one" }))

    const [code] = await closed
    expect(code).toBe(1008)
  })

  it("terminates a member before delivery and framing exceed its send buffer budget", async () => {
    const event = { type: "updated", payload: "a".repeat(60) }
    const bytes = Buffer.byteLength(JSON.stringify({ type: "event", channel: "one", event }))
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription: () => true,
      limits: { maxBufferedBytes: bytes },
    })
    const socket = await hub.connect()
    await sendMessage(socket, { type: "subscribe", channel: "one" })
    const closed = once(socket, "close") as Promise<[number]>

    hub.realtime.broadcast("one", event)

    const [code] = await closed
    expect(code).toBe(1006)
  })

  it("terminates clients that do not answer heartbeats but keeps responsive clients", async () => {
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription: () => true,
      limits: { heartbeatIntervalMs: 40 },
    })
    const responsive = await hub.connect()
    const unresponsive = await hub.connect({ autoPong: false })
    const closed = once(unresponsive, "close") as Promise<[number]>

    const [code] = await closed

    expect(code).toBe(1006)
    expect(responsive.readyState).toBe(WebSocket.OPEN)
    expect(await sendMessage(responsive, { type: "subscribe", channel: "one" })).toEqual({
      type: "subscribed",
      channel: "one",
    })
  })

  it("closes clients, removes its listener, and leaves HTTP serving", async () => {
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription: () => true,
    })
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

  it("finishes shutdown when a client never processes the closing handshake", async () => {
    const hub = await openServer({
      authenticate: () => "reader",
      authorizeSubscription: () => true,
      limits: { shutdownTimeoutMs: 40 },
    })
    const socket = await hub.connect()
    socket.pause()
    const closed = once(socket, "close")

    await hub.realtime.close()
    socket.resume()
    await closed

    expect(socket.readyState).toBe(WebSocket.CLOSED)
  })
})
