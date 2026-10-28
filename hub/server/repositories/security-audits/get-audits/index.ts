import { auditResultLimit, auditRetentionMs } from "#server/repositories/security-audits/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function getSecurityAudits(database: Prisma.TransactionClient) {
  return database.securityAudit.findMany({
    where: { createdAt: { gte: new Date(Date.now() - auditRetentionMs) } },
    orderBy: { createdAt: "desc" },
    take: auditResultLimit,
  })
}
