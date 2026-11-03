import "dotenv/config"
import { z } from "zod"

import { createConfiguredArtifactStorage } from "../domains/artifacts/create-configured-artifact-storage/index.ts"
import { startTelemetry } from "../integrations/opentelemetry/start-telemetry/index.ts"
import { logger } from "../integrations/pino/index.ts"
import { jobProcessors } from "./configuration.ts"
import { runJobWorker } from "./run-job-worker/index.ts"
import { parseRuntimeConfig } from "../utils/parse-runtime-config/index.ts"

try {
  const name = z.enum(["on-demand", "scheduled"]).parse(process.argv[2])
  const configuration = parseRuntimeConfig({ ...process.env, RUNTIME_MODE: name })
  if (configuration.hasArtifactStorage) await createConfiguredArtifactStorage(process.env)
  const databaseUrl = configuration.databaseUrl
  if (!databaseUrl) throw new Error("Workers require DATABASE_URL.")
  const concurrency =
    name === "on-demand" ? configuration.onDemandConcurrency : configuration.scheduledConcurrency
  const telemetry = startTelemetry(process.env, logger)
  try {
    await runJobWorker({
      name,
      databaseUrl,
      concurrency,
      shutdownTimeoutMs: configuration.shutdownTimeoutMs,
      logger,
      processors: jobProcessors[name],
    })
  } finally {
    await telemetry.shutdown()
  }
} catch (error) {
  logger.fatal(
    { errorType: error instanceof Error ? error.name : "UnknownError" },
    "Job worker failed; check database access, worker configuration, telemetry, and shutdown time",
  )
  process.exit(1)
}
