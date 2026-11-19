import type { WebSocket } from "ws"

import { disconnect } from "../disconnect/index.ts"
import { sendMessage } from "../send-message/index.ts"
import type { Connection, RealtimeState } from "../types.ts"

export function revalidateSubscription(
  state: RealtimeState,
  socket: WebSocket,
  connection: Connection,
  channel: string,
  message?: string,
) {
  const authorize = connection.revalidate
  if (!authorize) {
    if (message) sendMessage(state, socket, connection, message)
    return
  }
  const running = connection.rechecks.get(channel)
  if (running) {
    if (message) running.message = message
    return
  }
  if (state.accessChecks >= state.limits.maxConnections) {
    disconnect(state, socket, connection, "access_check_capacity_exceeded")
    return
  }
  const controller = new AbortController()
  const check = { controller, message }
  connection.rechecks.set(channel, check)
  state.accessChecks += 1
  const timeout = setTimeout(() => {
    controller.abort()
    disconnect(state, socket, connection, "access_check_timed_out")
  }, state.limits.upgradeTimeoutMs)
  timeout.unref()

  void (async () => {
    try {
      const allowed = await authorize(channel, controller.signal)
      if (controller.signal.aborted || !connection.subscriptions.has(channel)) return
      if (!allowed) {
        socket.close(4403, "Review access is no longer available")
      } else if (check.message) {
        sendMessage(state, socket, connection, check.message)
      }
    } catch {
      if (!controller.signal.aborted) disconnect(state, socket, connection, "access_check_failed")
    } finally {
      clearTimeout(timeout)
      state.accessChecks -= 1
      if (connection.rechecks.get(channel) === check) connection.rechecks.delete(channel)
    }
  })()
}
