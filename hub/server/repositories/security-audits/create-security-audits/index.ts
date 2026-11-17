import type { Prisma } from "../../../generated/prisma/client.ts"
import type { CreateSecurityAuditEvent } from "../create-security-audit/types.ts"
import { getSecurityAuditData } from "../get-security-audit-data/index.ts"
import { parseSecurityAuditEvent } from "../parse-security-audit-event/index.ts"

export async function createSecurityAudits(
  database: Pick<Prisma.TransactionClient, "securityAudit">,
  events: CreateSecurityAuditEvent[],
) {
  if (!events.length) return
  await database.securityAudit.createMany({
    data: events.map((event) => getSecurityAuditData(parseSecurityAuditEvent(event))),
  })
}
