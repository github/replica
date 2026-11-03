import { normalizeBoundedJson } from "../../../utils/normalize-bounded-json/index.ts"
import type { ProviderKey } from "../../../utils/parse-provider-key/types.ts"
import { securityAuditContextLimits } from "../constants.ts"

type SecurityAuditContextValue = boolean | number | string | null

export function createSecurityAuditContextWithProviderKey(
  value: Record<string, SecurityAuditContextValue> & { provider: ProviderKey },
) {
  const normalized = normalizeBoundedJson(
    {
      ...value,
      provider: "x".repeat(value.provider.length),
    },
    securityAuditContextLimits,
  )
  const context = { ...normalized, provider: value.provider }
  if (Buffer.byteLength(JSON.stringify(context), "utf8") > securityAuditContextLimits.maxBytes) {
    throw new Error(`JSON data cannot exceed ${securityAuditContextLimits.maxBytes} bytes.`)
  }
  return context
}
