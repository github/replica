import "dotenv/config"

import { createServer } from "node:http"

import { createApp } from "./create-app/index.ts"
import { log } from "./integrations/pino/log/index.ts"
import { logger } from "./integrations/pino/index.ts"
import { attachRealtimeServer } from "./integrations/ws/attach-realtime-server/index.ts"
import { shutdownServer } from "./shutdown-server/index.ts"

const port = Number(process.env.PORT ?? 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.")
}

const server = createServer()
const realtime = attachRealtimeServer({ server, path: "/api/realtime", logger })
server.on("request", createApp({ broadcast: realtime.broadcast }))
server.listen(port, "127.0.0.1", () => {
  log("info", "Hub API listening", { host: "127.0.0.1", port })
})

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  void shutdownServer(server, realtime)
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
