import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import pino from "pino"
import { onTestFinished } from "vitest"
import WebSocket from "ws"

import { attachRealtimeServer } from "../../../server/integrations/ws/attach-realtime-server"

import type { Options } from "./types"

export async function openServer(options: Options = {}) {
  const server = createServer((_request, response) => response.end("healthy"))
  const realtime = attachRealtimeServer({
    ...options,
    server,
    path: "/realtime",
    logger: options.logger ?? pino({ level: "silent" }),
  })
  const sockets: WebSocket[] = []

  onTestFinished(async () => {
    for (const socket of sockets) socket.terminate()
    await realtime.close()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  const url = `ws://127.0.0.1:${port}/realtime`

  function client(clientOptions: WebSocket.ClientOptions = {}, target = url) {
    const socket = new WebSocket(target, clientOptions)
    // Rejected handshakes emit an expected error after their HTTP response.
    socket.on("error", () => {})
    sockets.push(socket)
    return socket
  }

  async function connect(clientOptions?: WebSocket.ClientOptions) {
    const socket = client(clientOptions)
    await once(socket, "open")
    return socket
  }

  return { server, realtime, url, client, connect }
}
