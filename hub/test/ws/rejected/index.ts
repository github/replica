import { once } from "node:events"
import type { IncomingMessage } from "node:http"
import type WebSocket from "ws"

export async function rejected(socket: WebSocket) {
  const [, response] = (await once(socket, "unexpected-response")) as [unknown, IncomingMessage]
  response.resume()
  socket.terminate()
  return response.statusCode
}
