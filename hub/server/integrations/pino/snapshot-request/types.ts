import type { LogValue } from "../../../utils/logging/sanitize-log-value/types.ts"

export interface RequestSnapshot {
  route: string | null
  params: LogValue
  query: LogValue
  body?: LogValue
}
