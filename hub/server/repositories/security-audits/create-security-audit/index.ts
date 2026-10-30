import { getSecurityAuditData } from "../get-security-audit-data/index.ts"
import { parseSecurityAuditEvent } from "../parse-security-audit-event/index.ts"
import type { CreateSecurityAuditDatabase, CreateSecurityAuditEvent } from "./types.ts"

export function createSecurityAudit(
  database: CreateSecurityAuditDatabase,
  event: CreateSecurityAuditEvent,
): Promise<unknown>
export function createSecurityAudit(database: CreateSecurityAuditDatabase, input: unknown) {
  return database.securityAudit.create({
    data: getSecurityAuditData(parseSecurityAuditEvent(input)),
  })
}
