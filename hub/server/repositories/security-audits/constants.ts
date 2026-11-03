import type { NormalizeBoundedJsonLimits } from "../../utils/normalize-bounded-json/types.ts"

export const securityAuditContextLimits: NormalizeBoundedJsonLimits = {
  maxArrayItems: 0,
  maxBytes: 4_096,
  maxDepth: 1,
  maxEntries: 8,
  maxKeyLength: 100,
  maxObjectFields: 8,
  maxStringLength: 500,
}
