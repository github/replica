import type { Server } from "node:http"

/** Stops the server and resolves after it releases its port. */
export function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
