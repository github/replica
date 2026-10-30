import { createServer } from "node:http"
import type { Logger } from "pino"

import { createApp } from "../create-app/index.ts"

export async function runApi({
  port,
  logger,
  shutdownTimeoutMs = 30_000,
}: {
  port: number
  logger: Logger
  shutdownTimeoutMs?: number
}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("API port must be an integer between 0 and 65535.")
  }
  if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1) {
    throw new Error("API shutdown timeout must be a positive integer.")
  }
  const server = createServer(createApp({ logger }))
  let finishBinding!: () => void
  const binding = new Promise<void>((resolve) => {
    finishBinding = resolve
  })
  server.once("listening", finishBinding)
  server.once("error", finishBinding)
  let stop!: () => void
  const stopping = new Promise<void>((resolve, reject) => {
    stop = resolve
    server.once("error", reject)
  })
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  try {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address()
      logger.info(
        { host: "127.0.0.1", port: typeof address === "object" ? address?.port : port },
        "Hub API listening",
      )
    })
    await stopping
  } finally {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    let timer: ReturnType<typeof setTimeout> | undefined
    async function drain() {
      // A stop signal can arrive before listen() has opened its socket.
      await binding
      if (!server.listening) return
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
    try {
      await Promise.race([
        drain(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            server.closeAllConnections()
            reject(new Error("API shutdown exceeded its deadline."))
          }, shutdownTimeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
      server.removeListener("listening", finishBinding)
      server.removeListener("error", finishBinding)
    }
  }
}
