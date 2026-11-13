import { access } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import type { Logger } from "pino"

import { createApp } from "../create-app/index.ts"
import type { AuthenticationRouteDependencies } from "../routes/api/auth/types.ts"
import type { ProductRouteDependencies } from "../routes/api/product/types.ts"
import type { GitHubWebhookRouteDependencies } from "../routes/api/github/webhooks/types.ts"
import type { GitHubSetupRouteDependencies } from "../routes/api/settings/github/types.ts"
import { attachRealtimeServer } from "../integrations/ws/attach-realtime-server/index.ts"
import { shutdownServer } from "../shutdown-server/index.ts"

export async function runApi({
  port,
  logger,
  authentication,
  githubSetup,
  githubWebhooks,
  product,
  trustedProxyHops = 0,
  shutdownTimeoutMs = 30_000,
  host = "127.0.0.1",
  clientDirectory,
  signal,
  isReady,
}: {
  port: number
  logger: Logger
  authentication?: AuthenticationRouteDependencies
  product?: ProductRouteDependencies
  githubSetup?: GitHubSetupRouteDependencies
  githubWebhooks?: GitHubWebhookRouteDependencies
  trustedProxyHops?: number
  shutdownTimeoutMs?: number
  host?: string
  clientDirectory?: string
  signal?: AbortSignal
  isReady?: () => Promise<boolean>
}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("API port must be an integer between 0 and 65535.")
  }
  if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1) {
    throw new Error("API shutdown timeout must be a positive integer.")
  }
  if (clientDirectory) await access(resolve(clientDirectory, "index.html"))
  const server = createServer()
  let bindingStarted = false
  const realtime = attachRealtimeServer({ server, path: "/api/realtime", logger })
  let stoppingRequested = false
  server.on(
    "request",
    createApp({
      logger,
      broadcast: realtime.broadcast,
      clientDirectory,
      isReady: async () => !stoppingRequested && (isReady ? await isReady() : true),
      authentication,
      githubSetup,
      githubWebhooks,
      product,
      trustedProxyHops,
    }),
  )
  let finishBinding!: () => void
  const binding = new Promise<void>((resolve) => {
    finishBinding = resolve
  })
  server.once("listening", finishBinding)
  server.once("error", finishBinding)
  let stop!: () => void
  const stopping = new Promise<void>((resolve, reject) => {
    stop = () => {
      stoppingRequested = true
      resolve()
    }
    server.once("error", reject)
  })
  if (signal) signal.addEventListener("abort", stop, { once: true })
  else {
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  }
  try {
    if (signal?.aborted) return
    bindingStarted = true
    server.listen(port, host, () => {
      const address = server.address()
      logger.info(
        { host, port: typeof address === "object" ? address?.port : port },
        "Hub API listening",
      )
    })
    await stopping
  } finally {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    signal?.removeEventListener("abort", stop)
    let timer: ReturnType<typeof setTimeout> | undefined
    async function drain() {
      // A stop signal can arrive before listen() has opened its socket.
      if (bindingStarted) await binding
      await shutdownServer(server, realtime)
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
