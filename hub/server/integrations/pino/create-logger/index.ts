import pino from "pino"

import { formatLogFields } from "../format-log-fields/index.ts"
import type { LoggerOptions } from "./types.ts"

/** Apply one output and privacy policy to application and request logs. */
export function createLogger({ level = "info", destination }: LoggerOptions = {}) {
  return pino(
    {
      name: "replica-hub",
      level,
      formatters: {
        log: formatLogFields,
      },
    },
    destination,
  )
}
