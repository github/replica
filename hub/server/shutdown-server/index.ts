import type { Server } from "node:http"

import { log } from "../integrations/pino/log/index.ts"
import type { RealtimeServer } from "../integrations/ws/types.ts"

export async function shutdownServer(server: Server, realtime: RealtimeServer) {
  const httpClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  try {
    await Promise.all([realtime.close(), httpClosed])
  } catch {
    log("error", "Hub API shutdown failed")
    process.exitCode = 1
  }
}
