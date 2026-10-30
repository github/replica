import { WebSocket } from "ws"

import { disconnect } from "../disconnect/index.ts"
import type { Connection, RealtimeState } from "../types.ts"

export function canSend(
  state: RealtimeState,
  socket: WebSocket,
  connection: Connection,
  bytes: number,
) {
  if (socket.readyState !== WebSocket.OPEN) return false
  if (socket.bufferedAmount + bytes > state.limits.maxBufferedBytes) {
    disconnect(state, socket, connection, "send_buffer_limit")
    return false
  }
  return true
}
