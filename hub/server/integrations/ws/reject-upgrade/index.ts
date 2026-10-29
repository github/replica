import type { Duplex } from "node:stream"

import type { RealtimeState } from "../types.ts"

export function rejectUpgrade(
  { logger, rejectedUpgrades }: RealtimeState,
  socket: Duplex,
  status: number,
) {
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
