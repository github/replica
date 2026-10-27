import { maxLogKeyLength } from "../../../utils/logging/sanitize-log-value/constants.ts"
import { sanitizeLogValue } from "../../../utils/logging/sanitize-log-value/index.ts"

/** Bound fields independently so a large payload cannot hide useful metadata. */
export function formatLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    const descriptor = Object.getOwnPropertyDescriptor(fields, key)
    const value: unknown = descriptor && "value" in descriptor ? descriptor.value : "[UNAVAILABLE]"
    const safe = sanitizeLogValue({ [key]: value })
    if (safe !== null && typeof safe === "object" && !Array.isArray(safe)) {
      Object.assign(result, safe)
    } else {
      result[key.slice(0, maxLogKeyLength)] = safe
    }
  }
  return result
}
