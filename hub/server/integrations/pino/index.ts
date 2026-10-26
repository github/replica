import "dotenv/config"

import { createLogger } from "./create-logger/index.ts"

const level = (["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const).find(
  (candidate) => candidate === (process.env.LOG_LEVEL ?? "info"),
)
if (!level) {
  throw new Error("LOG_LEVEL must be trace, debug, info, warn, error, fatal, or silent.")
}

export const logger = createLogger({ level })
