import type { WebSocket } from "ws"

import { sendMessage } from "../send-message/index.ts"
import type { Connection, RealtimeState } from "../types.ts"

export function sendError(
  state: RealtimeState,
  socket: WebSocket,
  connection: Connection,
  code: string,
) {
  state.logger.warn({ connectionId: connection.id, code }, "WebSocket message rejected")
  sendMessage(state, socket, connection, JSON.stringify({ type: "error", code }))
}
