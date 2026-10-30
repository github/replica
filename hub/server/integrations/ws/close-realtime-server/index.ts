import type { Server } from "node:http"

import { reportRejections } from "../report-rejections/index.ts"
import type { RealtimeState, UpgradeListener } from "../types.ts"

export function closeRealtimeServer(
  state: RealtimeState,
  server: Server,
  upgrade: UpgradeListener,
  heartbeat: NodeJS.Timeout,
): Promise<void> {
  if (state.closePromise) return state.closePromise
  state.closing = true
  server.off("upgrade", upgrade)
  clearInterval(heartbeat)
  reportRejections(state)
  for (const cancel of state.pending.values()) cancel()
  state.addresses.clear()
  state.channels.clear()
  state.closePromise = new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      for (const socket of state.connections.keys()) socket.terminate()
    }, state.limits.shutdownTimeoutMs)
    deadline.unref()
    for (const socket of state.connections.keys()) socket.close(1001, "Server shutting down")
    state.wss.close((error) => {
      clearTimeout(deadline)
      if (error) reject(error)
      else resolve()
    })
  })
  return state.closePromise
}
