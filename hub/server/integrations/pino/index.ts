import "dotenv/config"

import { logLevels } from "./constants.ts"
import { createLogger } from "./create-logger/index.ts"

const level = logLevels.find((candidate) => candidate === (process.env.LOG_LEVEL ?? "info"))
if (!level) {
  throw new Error("LOG_LEVEL must be trace, debug, info, warn, error, fatal, or silent.")
}

export const logger = createLogger({ level })
