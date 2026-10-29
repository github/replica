import { randomUUID } from "node:crypto"
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { WebSocket, WebSocketServer } from "ws"
import { z } from "zod"

import { DEFAULT_LIMITS } from "../constants.ts"
import type { RealtimeOptions, RealtimeServer } from "../types.ts"

const channelSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._/-]*$/)
const messageSchema = z.strictObject({
  type: z.enum(["subscribe", "unsubscribe"]),
  channel: channelSchema,
})
const eventSchema = z.strictObject({ type: z.string().min(1).max(100), payload: z.json() })

interface AddressState {
  connections: number
  attempts: number
  windowEndsAt: number
}

interface Connection {
  id: string
  subscriptions: Set<string>
  alive: boolean
  busy: boolean
  messages: number
  windowEndsAt: number
  check?: AbortController
}

/** Own only local connections; application callbacks decide who may connect and subscribe. */
export function attachRealtimeServer<Identity>({
  server,
  path,
  logger,
  limits: overrides,
  authenticate,
  authorizeSubscription,
}: RealtimeOptions<Identity>): RealtimeServer {
  if (!/^\/[^?#]*$/.test(path)) throw new Error("WebSocket path must be an absolute URL path.")
  const limits = { ...DEFAULT_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(
        `WebSocket limit ${name} must be a positive integer no greater than 2147483647.`,
      )
    }
  }

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: limits.maxMessageBytes,
    maxFragments: 128,
    maxBufferedChunks: 128,
    perMessageDeflate: false,
    autoPong: false,
  })
  const connections = new Map<WebSocket, Connection>()
  const channels = new Map<string, Set<WebSocket>>()
  const addresses = new Map<string, AddressState>()
  const pending = new Map<Duplex, () => void>()
  const rejectedUpgrades = new Map<number, number>()
  let reserved = 0
  let accessChecks = 0
  let closing = false
  let closePromise: Promise<void> | undefined

  function pruneAddresses() {
    const now = Date.now()
    for (const [address, state] of addresses) {
      if (state.connections === 0 && state.windowEndsAt <= now) addresses.delete(address)
    }
  }

  function rejectUpgrade(socket: Duplex, status: number) {
    const count = rejectedUpgrades.get(status) ?? 0
    if (count === 0) logger.warn({ statusCode: status }, "WebSocket upgrade rejected")
    rejectedUpgrades.set(status, count + 1)
    if (!socket.destroyed) {
      socket.end(
        `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        () => socket.destroy(),
      )
    }
  }

  function reportRejections() {
    for (const [statusCode, count] of rejectedUpgrades) {
      if (count > 1) {
        logger.warn({ statusCode, count: count - 1 }, "Additional WebSocket upgrades rejected")
      }
    }
    rejectedUpgrades.clear()
  }

  function removeSubscription(socket: WebSocket, connection: Connection, channel: string) {
    connection.subscriptions.delete(channel)
    const subscribers = channels.get(channel)
    subscribers?.delete(socket)
    if (subscribers?.size === 0) channels.delete(channel)
  }

  function disconnect(socket: WebSocket, connection: Connection, reason: string) {
    logger.warn({ connectionId: connection.id, reason }, "WebSocket connection terminated")
    socket.terminate()
  }

  function canSend(socket: WebSocket, connection: Connection, bytes: number) {
    if (socket.readyState !== WebSocket.OPEN) return false
    if (socket.bufferedAmount + bytes > limits.maxBufferedBytes) {
      disconnect(socket, connection, "send_buffer_limit")
      return false
    }
    return true
  }

  function send(socket: WebSocket, connection: Connection, message: string) {
    const bytes = Buffer.byteLength(message)
    const frameBytes = bytes < 126 ? 2 : bytes <= 65535 ? 4 : 10
    if (!canSend(socket, connection, bytes + frameBytes)) return
    socket.send(message, (error) => {
      if (error) disconnect(socket, connection, "send_failed")
    })
  }

  function sendError(socket: WebSocket, connection: Connection, code: string) {
    logger.warn({ connectionId: connection.id, code }, "WebSocket message rejected")
    send(socket, connection, JSON.stringify({ type: "error", code }))
  }

  function countMessage(socket: WebSocket, connection: Connection) {
    if (closing || socket.readyState !== WebSocket.OPEN) return false
    if (Date.now() >= connection.windowEndsAt) {
      connection.messages = 0
      connection.windowEndsAt = Date.now() + 1000
    }
    connection.messages += 1
    if (connection.messages > limits.maxMessagesPerSecond) {
      logger.warn({ connectionId: connection.id }, "WebSocket message rate exceeded")
      socket.close(1008, "Message rate exceeded")
      return false
    }
    return true
  }

  async function handleMessage(
    socket: WebSocket,
    connection: Connection,
    identity: Identity,
    data: Buffer,
    isBinary: boolean,
  ) {
    if (!countMessage(socket, connection)) return
    if (connection.busy) {
      logger.warn({ connectionId: connection.id }, "WebSocket subscription check already pending")
      socket.close(1008, "Subscription check already pending")
      return
    }
    let input: unknown
    try {
      if (isBinary) throw new Error("Binary messages are not supported.")
      input = JSON.parse(data.toString())
    } catch {
      sendError(socket, connection, "INVALID_MESSAGE")
      return
    }
    const parsed = messageSchema.safeParse(input)
    if (!parsed.success) {
      sendError(socket, connection, "INVALID_MESSAGE")
      return
    }
    const { type, channel } = parsed.data
    if (type === "unsubscribe") {
      removeSubscription(socket, connection, channel)
      send(socket, connection, JSON.stringify({ type: "unsubscribed", channel }))
      return
    }
    if (
      !connection.subscriptions.has(channel) &&
      connection.subscriptions.size >= limits.maxSubscriptionsPerConnection
    ) {
      sendError(socket, connection, "SUBSCRIPTION_LIMIT")
      return
    }
    if (accessChecks >= limits.maxConnections) {
      logger.warn({ connectionId: connection.id }, "WebSocket access check capacity exceeded")
      socket.close(1013, "Server busy")
      return
    }
    connection.busy = true
    accessChecks += 1
    const controller = new AbortController()
    connection.check = controller
    const timeout = setTimeout(() => {
      controller.abort()
      logger.warn({ connectionId: connection.id }, "WebSocket subscription check timed out")
      socket.close(1008, "Subscription check timed out")
    }, limits.upgradeTimeoutMs)
    timeout.unref()
    try {
      const allowed = await authorizeSubscription?.(identity, channel, controller.signal)
      if (closing || socket.readyState !== WebSocket.OPEN) return
      if (!allowed) {
        removeSubscription(socket, connection, channel)
        sendError(socket, connection, "FORBIDDEN")
        return
      }
      connection.subscriptions.add(channel)
      let subscribers = channels.get(channel)
      if (!subscribers) {
        subscribers = new Set()
        channels.set(channel, subscribers)
      }
      subscribers.add(socket)
      send(socket, connection, JSON.stringify({ type: "subscribed", channel }))
    } catch {
      if (controller.signal.aborted) return
      logger.error({ connectionId: connection.id }, "WebSocket subscription check failed")
      socket.close(1011, "Subscription check failed")
    } finally {
      clearTimeout(timeout)
      accessChecks -= 1
      connection.check = undefined
      connection.busy = false
    }
  }

  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    function socketError() {
      logger.warn({}, "WebSocket transport failed")
      socket.destroy()
    }
    socket.on("error", socketError)
    socket.once("close", () => socket.off("error", socketError))
    if (request.url?.split("?")[0] !== path) {
      rejectUpgrade(socket, 404)
      return
    }
    if (closing) {
      rejectUpgrade(socket, 503)
      return
    }

    // Use the peer address, never an untrusted forwarded header.
    const address = request.socket.remoteAddress
    if (!address) {
      rejectUpgrade(socket, 400)
      return
    }
    let state = addresses.get(address)
    const now = Date.now()
    if (!state) {
      if (addresses.size >= limits.maxTrackedAddresses) pruneAddresses()
      if (addresses.size >= limits.maxTrackedAddresses) {
        rejectUpgrade(socket, 503)
        return
      }
      state = { connections: 0, attempts: 0, windowEndsAt: now + 60_000 }
      addresses.set(address, state)
    }
    if (state.windowEndsAt <= now) {
      state.attempts = 0
      state.windowEndsAt = now + 60_000
    }
    state.attempts += 1
    if (
      state.attempts > limits.maxUpgradeAttemptsPerMinute ||
      state.connections >= limits.maxConnectionsPerAddress
    ) {
      rejectUpgrade(socket, 429)
      return
    }
    if (reserved >= limits.maxConnections || accessChecks >= limits.maxConnections) {
      rejectUpgrade(socket, 503)
      return
    }
    if (!authenticate || !authorizeSubscription) {
      rejectUpgrade(socket, 403)
      return
    }

    reserved += 1
    state.connections += 1
    const addressState = state
    let released = false
    let completed = false
    const controller = new AbortController()
    function release() {
      if (released) return
      released = true
      reserved -= 1
      addressState.connections -= 1
    }
    function cancel() {
      if (completed) return
      completed = true
      clearTimeout(timeout)
      pending.delete(socket)
      controller.abort()
      release()
    }
    const timeout = setTimeout(() => {
      cancel()
      rejectUpgrade(socket, 408)
    }, limits.upgradeTimeoutMs)
    timeout.unref()
    pending.set(socket, () => {
      cancel()
      socket.destroy()
    })
    socket.once("close", cancel)

    async function admit() {
      accessChecks += 1
      try {
        const identity = await authenticate?.(request, controller.signal)
        if (completed || socket.destroyed || closing) return
        if (identity === null || identity === undefined) {
          cancel()
          rejectUpgrade(socket, 401)
          return
        }
        wss.handleUpgrade(request, socket, head, (client) => {
          completed = true
          clearTimeout(timeout)
          pending.delete(socket)
          socket.off("close", cancel)
          socket.off("error", socketError)
          const connection: Connection = {
            id: randomUUID(),
            subscriptions: new Set(),
            alive: true,
            busy: false,
            messages: 0,
            windowEndsAt: Date.now() + 1000,
          }
          connections.set(client, connection)
          logger.info(
            { connectionId: connection.id, activeConnections: connections.size },
            "WebSocket connected",
          )
          client.on("pong", () => {
            if (countMessage(client, connection)) connection.alive = true
          })
          client.on("ping", (data) => {
            if (
              !countMessage(client, connection) ||
              !canSend(client, connection, data.length + 2)
            ) {
              return
            }
            client.pong(data, false, (error) => {
              if (error) disconnect(client, connection, "send_failed")
            })
          })
          client.on("message", (data, isBinary) => {
            const buffer = Array.isArray(data)
              ? Buffer.concat(data)
              : Buffer.isBuffer(data)
                ? data
                : Buffer.from(data)
            void handleMessage(client, connection, identity, buffer, isBinary)
          })
          client.on("error", () => disconnect(client, connection, "transport_failed"))
          client.once("close", () => {
            connection.check?.abort()
            for (const channel of connection.subscriptions) {
              removeSubscription(client, connection, channel)
            }
            connections.delete(client)
            release()
            logger.info(
              { connectionId: connection.id, activeConnections: connections.size },
              "WebSocket disconnected",
            )
          })
        })
      } catch {
        if (completed || socket.destroyed) return
        cancel()
        logger.error({}, "WebSocket admission failed")
        rejectUpgrade(socket, 500)
      } finally {
        accessChecks -= 1
      }
    }
    void admit()
  }

  const heartbeat = setInterval(() => {
    reportRejections()
    pruneAddresses()
    for (const [socket, connection] of connections) {
      if (!connection.alive) {
        disconnect(socket, connection, "heartbeat_timeout")
      } else if (socket.readyState === WebSocket.OPEN) {
        connection.alive = false
        if (canSend(socket, connection, 2)) {
          socket.ping(undefined, false, (error) => {
            if (error) disconnect(socket, connection, "send_failed")
          })
        }
      }
    }
  }, limits.heartbeatIntervalMs)
  heartbeat.unref()
  server.on("upgrade", upgrade)
  wss.on("error", () => logger.error({}, "WebSocket server failed"))

  function broadcast(channel: string, event: Parameters<RealtimeServer["broadcast"]>[1]) {
    if (closing) throw new Error("WebSocket server is closed.")
    channelSchema.parse(channel)
    eventSchema.parse(event)
    const message = JSON.stringify({ type: "event", channel, event })
    if (Buffer.byteLength(message) > limits.maxMessageBytes) {
      throw new RangeError("WebSocket event exceeds the message size limit.")
    }
    for (const socket of channels.get(channel) ?? []) {
      const connection = connections.get(socket)
      if (connection) send(socket, connection, message)
    }
  }

  function close(): Promise<void> {
    if (closePromise) return closePromise
    closing = true
    server.off("upgrade", upgrade)
    clearInterval(heartbeat)
    reportRejections()
    for (const cancel of pending.values()) cancel()
    addresses.clear()
    channels.clear()
    closePromise = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        for (const socket of connections.keys()) socket.terminate()
      }, limits.shutdownTimeoutMs)
      deadline.unref()
      for (const socket of connections.keys()) socket.close(1001, "Server shutting down")
      wss.close((error) => {
        clearTimeout(deadline)
        if (error) reject(error)
        else resolve()
      })
    })
    return closePromise
  }

  return { broadcast, close }
}
