import { auditRetentionMs } from "#server/repositories/security-audits/constants"
import type { AuditInput } from "#server/repositories/security-audits/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function saveSecurityAudit(database: Prisma.TransactionClient, data: AuditInput) {
  await database.securityAudit.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - auditRetentionMs) } },
  })
  await database.securityAudit.create({ data })
}
