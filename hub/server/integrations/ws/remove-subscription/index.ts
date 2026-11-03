import type { WebSocket } from "ws"

import type { Connection, RealtimeState } from "../types.ts"

export function removeSubscription(
  { channels }: RealtimeState,
  socket: WebSocket,
  connection: Connection,
  channel: string,
) {
  connection.subscriptions.delete(channel)
  const subscribers = channels.get(channel)
  subscribers?.delete(socket)
  if (subscribers?.size === 0) channels.delete(channel)
}
