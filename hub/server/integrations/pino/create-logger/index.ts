import pino from "pino"

import { sanitizeLogValue } from "../../../utils/logging/sanitize-log-value/index.ts"
import type { LoggerOptions } from "./types.ts"

export function createLogger({ level = "info", destination }: LoggerOptions = {}) {
  return pino(
    {
      name: "replica-hub",
      level,
      formatters: {
        log(fields) {
          const result = Object.create(null) as Record<string, unknown>
          for (const key of Object.keys(fields).slice(0, 100)) {
            const descriptor = Object.getOwnPropertyDescriptor(fields, key)
            const value: unknown =
              descriptor && "value" in descriptor ? descriptor.value : "[UNAVAILABLE]"
            const safe = sanitizeLogValue({ [key]: value })
            if (safe !== null && typeof safe === "object" && !Array.isArray(safe)) {
              Object.assign(result, safe)
            } else {
              result[key.slice(0, 128)] = safe
            }
          }
          if (Object.keys(fields).length > 100) result.truncated = "[MAX FIELDS]"
          return result
        },
      },
    },
    destination,
  )
}
