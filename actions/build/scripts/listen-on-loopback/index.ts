import type { Server } from "node:http"

/** Starts the server on an available port bound to 127.0.0.1. */
export function listenOnLoopback(server: Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Static server did not bind to a loopback port."))
        return
      }

      resolve(address.port)
    })
  })
}
