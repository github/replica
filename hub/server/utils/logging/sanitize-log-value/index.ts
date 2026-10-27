import { Buffer } from "node:buffer"

import { visitLogValue } from "../visit-log-value/index.ts"

import { maxLogBytes } from "./constants.ts"
import type { LogValue } from "./types.ts"

/** Copy structured data with secret-key redaction and bounded JSON output. */
export function sanitizeLogValue(value: unknown): LogValue {
  const result = visitLogValue(value, 0, { ancestors: new WeakSet<object>(), entries: 0 })
  return Buffer.byteLength(JSON.stringify(result)) <= maxLogBytes ? result : "[OMITTED: MAX BYTES]"
}
