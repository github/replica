import type WebSocket from "ws"

export function parseMessage(data: WebSocket.RawData): unknown {
  const buffer = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.isBuffer(data)
      ? data
      : Buffer.from(data)
  return JSON.parse(buffer.toString()) as unknown
}
