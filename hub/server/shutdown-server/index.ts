import type { Server } from "node:http"

import type { RealtimeServer } from "../integrations/ws/types.ts"

export async function shutdownServer(server: Server, realtime: RealtimeServer) {
  const httpClosed = new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close((error) => (error ? reject(error) : resolve()))
  })
  const results = await Promise.allSettled([
    httpClosed,
    Promise.resolve().then(() => realtime.close()),
  ])
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("Hub API shutdown failed.")
  }
}
