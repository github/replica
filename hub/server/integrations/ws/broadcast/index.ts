import { CHANNEL_SCHEMA, EVENT_SCHEMA } from "../constants.ts"
import { sendMessage } from "../send-message/index.ts"
import type { Broadcast, RealtimeState } from "../types.ts"

export function broadcast(state: RealtimeState, channel: string, event: Parameters<Broadcast>[1]) {
  if (state.closing) throw new Error("WebSocket server is closed.")
  CHANNEL_SCHEMA.parse(channel)
  EVENT_SCHEMA.parse(event)
  const message = JSON.stringify({ type: "event", channel, event })
  if (Buffer.byteLength(message) > state.limits.maxMessageBytes) {
    throw new RangeError("WebSocket event exceeds the message size limit.")
  }
  for (const socket of state.channels.get(channel) ?? []) {
    const connection = state.connections.get(socket)
    if (connection) sendMessage(state, socket, connection, message)
  }
}
