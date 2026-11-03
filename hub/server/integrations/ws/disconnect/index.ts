import type { WebSocket } from "ws"

import type { Connection, RealtimeState } from "../types.ts"

export function disconnect(
  { logger }: RealtimeState,
  socket: WebSocket,
  connection: Connection,
  reason: string,
) {
  logger.warn({ connectionId: connection.id, reason }, "WebSocket connection terminated")
  socket.terminate()
}
