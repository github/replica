import { WebSocket } from "ws"

import { canSend } from "../can-send/index.ts"
import { disconnect } from "../disconnect/index.ts"
import { pruneAddresses } from "../prune-addresses/index.ts"
import { reportRejections } from "../report-rejections/index.ts"
import type { RealtimeState } from "../types.ts"

export function checkConnections(state: RealtimeState) {
  reportRejections(state)
  pruneAddresses(state)
  for (const [socket, connection] of state.connections) {
    if (!connection.alive) {
      disconnect(state, socket, connection, "heartbeat_timeout")
    } else if (socket.readyState === WebSocket.OPEN) {
      connection.alive = false
      if (canSend(state, socket, connection, 2)) {
        socket.ping(undefined, false, (error) => {
          if (error) disconnect(state, socket, connection, "send_failed")
        })
      }
    }
  }
}
