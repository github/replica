import { createConnection, createServer } from "node:net"

export function createTcpForwarder({
  listenHost,
  listenPort,
  targetHost,
  targetPort,
}: {
  listenHost: string
  listenPort: number
  targetHost: string
  targetPort: number
}) {
  return createServer((socket) => {
    const upstream = createConnection({ host: targetHost, port: targetPort })
    upstream.on("error", () => socket.destroy())
    socket.on("error", () => upstream.destroy())
    socket.pipe(upstream).pipe(socket)
  }).listen(listenPort, listenHost)
}
