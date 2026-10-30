import "dotenv/config"

import { startTelemetry } from "./integrations/opentelemetry/start-telemetry/index.ts"
import { logger } from "./integrations/pino/index.ts"
import { runApi } from "./run-api/index.ts"

const port = Number(process.env.PORT ?? 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.")
}

try {
  const telemetry = startTelemetry(process.env, logger)
  try {
    await runApi({ port, logger })
  } finally {
    await telemetry.shutdown()
  }
} catch {
  logger.fatal("Hub API failed; check API configuration, telemetry, and shutdown time.")
  process.exit(1)
}
