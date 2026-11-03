import { once } from "node:events"
import type WebSocket from "ws"

export async function sendMessage(socket: WebSocket, value: unknown) {
  const received = once(socket, "message") as Promise<[Buffer]>
  socket.send(JSON.stringify(value))
  const [data] = await received
  return JSON.parse(String(data)) as unknown
}
