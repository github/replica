import type { Logger } from "pino"

import { openDatabase } from "../integrations/postgres/open-database/index.ts"
import type { AuthenticationRouteDependencies } from "../routes/api/auth/types.ts"
import type { CopilotConnectionRouteDependencies } from "../routes/api/copilot-connection/types.ts"
import type { ProductRouteDependencies } from "../routes/api/product/types.ts"
import { runApi } from "../run-api/index.ts"
import { jobProcessors } from "../workers/configuration.ts"
import { runJobWorker } from "../workers/run-job-worker/index.ts"

export async function startServerProcesses(options: {
  port: number
  host: string
  databaseUrl: string
  clientDirectory?: string
  shutdownTimeoutMs: number
  logger: Logger
  onDemandConcurrency: number
  scheduledConcurrency: number
  isStorageReady?: () => Promise<boolean>
  authentication?: AuthenticationRouteDependencies
  copilotConnection?: CopilotConnectionRouteDependencies
  product?: ProductRouteDependencies
  trustedProxyHops?: number
}) {
  const controller = new AbortController()
  function stop() {
    controller.abort(null)
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  const database = openDatabase(options.databaseUrl)
  const ready = new Set<string>()
  database.on("error", (error) => {
    options.logger.error({ errorType: error.name }, "Hub database connection failed")
    controller.abort(error)
  })
  const roles: Promise<void>[] = []
  let failed: boolean
  try {
    await database.query("SELECT 1")
    if (!controller.signal.aborted) {
      roles.push(
        ...(["on-demand", "scheduled"] as const).map((name) =>
          runJobWorker({
            name,
            databaseUrl: options.databaseUrl,
            concurrency:
              name === "on-demand" ? options.onDemandConcurrency : options.scheduledConcurrency,
            shutdownTimeoutMs: options.shutdownTimeoutMs,
            logger: options.logger,
            processors: jobProcessors[name],
            signal: controller.signal,
            onReady: () => ready.add(name),
          }),
        ),
        runApi({
          ...options,
          signal: controller.signal,
          isReady: async () => {
            if (controller.signal.aborted || ready.size !== 2) return false
            await database.query("SELECT 1")
            if (options.isStorageReady && !(await options.isStorageReady())) return false
            return true
          },
        }),
      )
      await Promise.race(roles)
      if (!controller.signal.aborted) throw new Error("A required Hub component stopped.")
    }
  } finally {
    controller.abort(null)
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    const outcomes = await Promise.allSettled(roles)
    await database.end()
    failed = outcomes.some((outcome) => outcome.status === "rejected")
  }
  if (failed) throw new Error("A required Hub component failed.")
  if (controller.signal.reason instanceof Error) throw controller.signal.reason
}
