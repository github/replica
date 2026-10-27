import { Buffer } from "node:buffer"

import { visitLogValue } from "../visit-log-value/index.ts"

import { maxLogBytes, sensitiveLogKeyPattern } from "./constants.ts"
import type { LogValue } from "./types.ts"

/** Copy structured data with secret-key redaction and bounded JSON output. */
export function sanitizeLogValue(
  value: unknown,
  sensitiveKeyPattern: RegExp = sensitiveLogKeyPattern,
): LogValue {
  const result = visitLogValue(value, 0, {
    ancestors: new WeakSet<object>(),
    entries: 0,
    sensitiveKeyPattern,
  })
  return Buffer.byteLength(JSON.stringify(result)) <= maxLogBytes ? result : "[OMITTED: MAX BYTES]"
}
