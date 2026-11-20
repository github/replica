import { securityAuditResponseSchema } from "@application/hub/security-audit-contracts"

import { requestJson } from "../request-json"

export function getSecurityAudits(request: Request, before?: string, repositoryId?: string) {
  const path = repositoryId
    ? `/api/repositories/${encodeURIComponent(repositoryId)}/security-audit`
    : "/api/security-audits"
  const url = new URL(path, request.url)
  url.searchParams.set("limit", "50")
  if (before) url.searchParams.set("before", before)
  return requestJson(url, securityAuditResponseSchema, { signal: request.signal })
}
