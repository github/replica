import { access } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import type { Logger } from "pino"

import { createApp } from "../create-app/index.ts"
import type { AuthenticationRouteDependencies } from "../routes/api/auth/types.ts"
import type { AgentVisualCriticRouteDependencies } from "../routes/api/canvas/decision-model/types.ts"
import type { CopilotConnectionRouteDependencies } from "../routes/api/copilot-connection/types.ts"
import type { DecisionModelRouteDependencies } from "../routes/api/decision-model/types.ts"
import type { GitHubWebhookRouteDependencies } from "../routes/api/github/webhooks/types.ts"
import type { AgentConnectionRouteDependencies } from "../routes/agent-connections/types.ts"
import type { LearningsRouteDependencies } from "../routes/api/learnings/types.ts"
import type { ProductRouteDependencies } from "../routes/api/product/types.ts"
import type { PublicSharingRouteDependencies } from "../routes/api/public-sharing/types.ts"
import type { GitHubSetupRouteDependencies } from "../routes/api/settings/github/types.ts"
import type { BuildPreviewRouteDependencies } from "../routes/build-preview/types.ts"
import type { PrivatePreviewRouteDependencies } from "../routes/private-preview/types.ts"
import { attachRealtimeServer } from "../integrations/ws/attach-realtime-server/index.ts"
import { listenForReviewChanges } from "../integrations/postgres/listen-for-review-changes/index.ts"
import {
  createReviewRealtimeAccess,
  readReviewChannel,
} from "../routes/api/review-comments/create-review-realtime-access/index.ts"
import { shutdownServer } from "../shutdown-server/index.ts"

export async function runApi({
  port,
  logger,
  agentConnections,
  agentVisualCritic,
  authentication,
  githubSetup,
  githubWebhooks,
  copilotConnection,
  decisionModels,
  learnings,
  preview,
  privatePreview,
  product,
  publicSharing,
  trustedProxyHops = 0,
  shutdownTimeoutMs = 30_000,
  host = "127.0.0.1",
  clientDirectory,
  signal,
  isReady,
  databaseUrl,
}: {
  port: number
  logger: Logger
  agentConnections?: AgentConnectionRouteDependencies
  agentVisualCritic?: AgentVisualCriticRouteDependencies
  authentication?: AuthenticationRouteDependencies
  copilotConnection?: CopilotConnectionRouteDependencies
  decisionModels?: DecisionModelRouteDependencies
  learnings?: LearningsRouteDependencies
  preview?: BuildPreviewRouteDependencies
  privatePreview?: PrivatePreviewRouteDependencies
  product?: ProductRouteDependencies
  publicSharing?: PublicSharingRouteDependencies
  githubSetup?: GitHubSetupRouteDependencies
  githubWebhooks?: GitHubWebhookRouteDependencies
  trustedProxyHops?: number
  shutdownTimeoutMs?: number
  host?: string
  clientDirectory?: string
  signal?: AbortSignal
  isReady?: () => Promise<boolean>
  databaseUrl?: string
}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("API port must be an integer between 0 and 65535.")
  }
  if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1) {
    throw new Error("API shutdown timeout must be a positive integer.")
  }
  if (clientDirectory) await access(resolve(clientDirectory, "index.html"))
  const server = createServer()
  const operations = new AbortController()
  let bindingStarted = false
  const reviewAccess =
    databaseUrl && authentication && product?.isPrototypeReviewable
      ? createReviewRealtimeAccess(authentication, product)
      : undefined
  const realtime = attachRealtimeServer({
    server,
    path: "/api/realtime",
    logger,
    ...reviewAccess,
    ...(reviewAccess ? { limits: { maxSubscriptionsPerConnection: 1 } } : {}),
  })
  let stoppingRequested = false
  server.on(
    "request",
    createApp({
      logger,
      agentConnections,
      agentVisualCritic,
      broadcast: realtime.broadcast,
      clientDirectory,
      isReady: async () => !stoppingRequested && (isReady ? await isReady() : true),
      authentication,
      githubSetup,
      githubWebhooks,
      copilotConnection: copilotConnection
        ? {
            ...copilotConnection,
            continueAuthorization: copilotConnection.continueAuthorization
              ? (input) =>
                  copilotConnection.continueAuthorization!({
                    ...input,
                    signal: operations.signal,
                  })
              : undefined,
          }
        : undefined,
      decisionModels,
      learnings,
      product,
      publicSharing,
      preview,
      privatePreview,
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
  let reviewChanges: Promise<void> | undefined
  try {
    if (signal?.aborted) return
    if (databaseUrl && reviewAccess) {
      reviewChanges = listenForReviewChanges({
        databaseUrl,
        signal: operations.signal,
        logger,
        changed: (scope) => {
          const channel = `review:${scope}`
          if (readReviewChannel(channel))
            realtime.broadcast(channel, { type: "changed", payload: null })
        },
        resynchronize: realtime.resynchronize,
      })
    }
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
    operations.abort(new Error("Hub API is stopping."))
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    signal?.removeEventListener("abort", stop)
    let timer: ReturnType<typeof setTimeout> | undefined
    async function drain() {
      // A stop signal can arrive before listen() has opened its socket.
      if (bindingStarted) await binding
      const settled = await Promise.allSettled([shutdownServer(server, realtime), reviewChanges])
      const failed = settled.find((result) => result.status === "rejected")
      if (failed) throw failed.reason
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
