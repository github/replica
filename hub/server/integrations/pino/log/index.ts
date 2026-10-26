import type { Level, Logger } from "pino"

import { logger } from "../index.ts"

export function log(
  level: Level,
  message: string,
  fields: Record<string, unknown> = {},
  target: Logger = logger,
) {
  target[level](fields, message)
}
