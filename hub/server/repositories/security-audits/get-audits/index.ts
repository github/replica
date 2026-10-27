import { auditResultLimit, auditRetentionMs } from "#server/repositories/security-audits/constants"
import type { SecurityAuditRecord } from "#server/repositories/security-audits/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getSecurityAudits(
  database: Prisma.TransactionClient,
): Promise<SecurityAuditRecord[]> {
  return database.securityAudit.findMany({
    where: { createdAt: { gte: new Date(Date.now() - auditRetentionMs) } },
    orderBy: { createdAt: "desc" },
    take: auditResultLimit,
  })
}
