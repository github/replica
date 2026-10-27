import { maxLogKeyLength } from "../../../utils/logging/sanitize-log-value/constants.ts"
import { sanitizeLogValue } from "../../../utils/logging/sanitize-log-value/index.ts"

import { maxLogFields } from "./constants.ts"

/** Bound fields independently so a large payload cannot hide useful metadata. */
export function formatLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>
  const keys = Object.keys(fields)
  for (const key of keys.slice(0, maxLogFields)) {
    const descriptor = Object.getOwnPropertyDescriptor(fields, key)
    const value: unknown = descriptor && "value" in descriptor ? descriptor.value : "[UNAVAILABLE]"
    const safe = sanitizeLogValue({ [key]: value })
    if (safe !== null && typeof safe === "object" && !Array.isArray(safe)) {
      Object.assign(result, safe)
    } else {
      result[key.slice(0, maxLogKeyLength)] = safe
    }
  }
  if (keys.length > maxLogFields) result.truncated = "[MAX FIELDS]"
  return result
}
