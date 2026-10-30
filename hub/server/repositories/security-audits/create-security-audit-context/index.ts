import { normalizeBoundedJson } from "../../../utils/normalize-bounded-json/index.ts"

export function createSecurityAuditContext(
  value: Record<string, boolean | number | string | null>,
) {
  return normalizeBoundedJson(value, {
    maxArrayItems: 0,
    maxBytes: 4_096,
    maxDepth: 1,
    maxEntries: 8,
    maxKeyLength: 100,
    maxObjectFields: 8,
    maxStringLength: 500,
  })
}
