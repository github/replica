import { securityAuditResponseSchema } from "@application/hub/security-audit-contracts"

import { requestJson } from "../request-json"

export function getSecurityAudits(request: Request, before?: string) {
  const url = new URL("/api/security-audits", request.url)
  url.searchParams.set("limit", "50")
  if (before) url.searchParams.set("before", before)
  return requestJson(url, securityAuditResponseSchema, { signal: request.signal })
}
