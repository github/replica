import { WebSocket } from "ws"

import type { Connection, RealtimeState } from "../types.ts"

export function countMessage(state: RealtimeState, socket: WebSocket, connection: Connection) {
  if (state.closing || socket.readyState !== WebSocket.OPEN) return false
  if (Date.now() >= connection.windowEndsAt) {
    connection.messages = 0
    connection.windowEndsAt = Date.now() + 1000
  }
  connection.messages += 1
  if (connection.messages > state.limits.maxMessagesPerSecond) {
    state.logger.warn({ connectionId: connection.id }, "WebSocket message rate exceeded")
    socket.close(1008, "Message rate exceeded")
    return false
  }
  return true
}
