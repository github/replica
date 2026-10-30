import { WebSocket } from "ws"

import { MESSAGE_SCHEMA } from "../constants.ts"
import { countMessage } from "../count-message/index.ts"
import { removeSubscription } from "../remove-subscription/index.ts"
import { sendError } from "../send-error/index.ts"
import { sendMessage } from "../send-message/index.ts"
import type { Connection, RealtimeOptions, RealtimeState } from "../types.ts"

export async function handleMessage<Identity>(
  state: RealtimeState,
  socket: WebSocket,
  connection: Connection,
  identity: Identity,
  data: Buffer,
  isBinary: boolean,
  authorizeSubscription: RealtimeOptions<Identity>["authorizeSubscription"],
) {
  const { logger, limits } = state
  if (!countMessage(state, socket, connection)) return
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
    sendError(state, socket, connection, "INVALID_MESSAGE")
    return
  }
  const parsed = MESSAGE_SCHEMA.safeParse(input)
  if (!parsed.success) {
    sendError(state, socket, connection, "INVALID_MESSAGE")
    return
  }
  const { type, channel } = parsed.data
  if (type === "unsubscribe") {
    removeSubscription(state, socket, connection, channel)
    sendMessage(state, socket, connection, JSON.stringify({ type: "unsubscribed", channel }))
    return
  }
  if (
    !connection.subscriptions.has(channel) &&
    connection.subscriptions.size >= limits.maxSubscriptionsPerConnection
  ) {
    sendError(state, socket, connection, "SUBSCRIPTION_LIMIT")
    return
  }
  if (state.accessChecks >= limits.maxConnections) {
    logger.warn({ connectionId: connection.id }, "WebSocket access check capacity exceeded")
    socket.close(1013, "Server busy")
    return
  }
  connection.busy = true
  state.accessChecks += 1
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
    if (state.closing || socket.readyState !== WebSocket.OPEN) return
    if (!allowed) {
      removeSubscription(state, socket, connection, channel)
      sendError(state, socket, connection, "FORBIDDEN")
      return
    }
    connection.subscriptions.add(channel)
    let subscribers = state.channels.get(channel)
    if (!subscribers) {
      subscribers = new Set()
      state.channels.set(channel, subscribers)
    }
    subscribers.add(socket)
    sendMessage(state, socket, connection, JSON.stringify({ type: "subscribed", channel }))
  } catch {
    if (controller.signal.aborted) return
    logger.error({ connectionId: connection.id }, "WebSocket subscription check failed")
    socket.close(1011, "Subscription check failed")
  } finally {
    clearTimeout(timeout)
    state.accessChecks -= 1
    connection.check = undefined
    connection.busy = false
  }
}
