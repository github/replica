import { normalizeBoundedJson } from "../../../utils/normalize-bounded-json/index.ts"
import type { ProviderKey } from "../../../utils/parse-provider-key/index.ts"

type SecurityAuditContextValue = boolean | number | string | null

const limits = {
  maxArrayItems: 0,
  maxBytes: 4_096,
  maxDepth: 1,
  maxEntries: 8,
  maxKeyLength: 100,
  maxObjectFields: 8,
  maxStringLength: 500,
}

function assertContextByteLimit(value: object) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > limits.maxBytes) {
    throw new Error(`JSON data cannot exceed ${limits.maxBytes} bytes.`)
  }
}

export function createSecurityAuditContext(value: Record<string, SecurityAuditContextValue>) {
  return normalizeBoundedJson(value, limits)
}

export function createSecurityAuditContextWithProviderKey(
  value: Record<string, SecurityAuditContextValue> & { provider: ProviderKey },
) {
  const normalized = normalizeBoundedJson(
    {
      ...value,
      provider: "x".repeat(value.provider.length),
    },
    limits,
  )
  const context = { ...normalized, provider: value.provider }
  assertContextByteLimit(context)
  return context
}
