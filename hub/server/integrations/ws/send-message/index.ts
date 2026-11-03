import type { WebSocket } from "ws"

import { canSend } from "../can-send/index.ts"
import { disconnect } from "../disconnect/index.ts"
import type { Connection, RealtimeState } from "../types.ts"

export function sendMessage(
  state: RealtimeState,
  socket: WebSocket,
  connection: Connection,
  message: string,
) {
  const bytes = Buffer.byteLength(message)
  const frameBytes = bytes < 126 ? 2 : bytes <= 65535 ? 4 : 10
  if (!canSend(state, socket, connection, bytes + frameBytes)) return
  socket.send(message, (error) => {
    if (error) disconnect(state, socket, connection, "send_failed")
  })
}
