import "dotenv/config"

import { createConfiguredArtifactStorage } from "./domains/artifacts/create-configured-artifact-storage/index.ts"
import { startTelemetry } from "./integrations/opentelemetry/start-telemetry/index.ts"
import { logger } from "./integrations/pino/index.ts"
import { runApi } from "./run-api/index.ts"
import { setup } from "./scripts/setup/index.ts"
import { startServerProcesses } from "./start-server-processes/index.ts"
import { parseRuntimeConfig } from "./utils/parse-runtime-config/index.ts"
import { jobProcessors } from "./workers/configuration.ts"
import { runJobWorker } from "./workers/run-job-worker/index.ts"

try {
  const configuration = parseRuntimeConfig(process.env)
  const storage =
    configuration.mode !== "setup" && configuration.hasArtifactStorage
      ? await createConfiguredArtifactStorage(process.env)
      : undefined
  const isStorageReady = storage ? () => storage.isReady() : undefined
  const telemetry = startTelemetry(process.env, logger)
  try {
    if (configuration.mode === "setup") await setup()
    else if (configuration.mode === "api")
      await runApi({ ...configuration, logger, isReady: isStorageReady })
    else {
      const databaseUrl = configuration.databaseUrl
      if (!databaseUrl) throw new Error("This runtime mode requires DATABASE_URL.")
      if (configuration.mode === "combined") {
        await startServerProcesses({
          ...configuration,
          databaseUrl,
          logger,
          isStorageReady,
        })
      } else {
        const name = configuration.mode
        await runJobWorker({
          name,
          databaseUrl,
          concurrency:
            name === "on-demand"
              ? configuration.onDemandConcurrency
              : configuration.scheduledConcurrency,
          shutdownTimeoutMs: configuration.shutdownTimeoutMs,
          logger,
          processors: jobProcessors[name],
        })
      }
    }
  } finally {
    await telemetry.shutdown()
  }
} catch {
  logger.fatal(
    "Hub failed; check runtime configuration, dependencies, telemetry, and shutdown time.",
  )
  process.exit(1)
}
