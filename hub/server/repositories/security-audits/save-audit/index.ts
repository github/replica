import type { AuditInput } from "#server/utils/identity-contracts/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function saveSecurityAudit(database: Prisma.TransactionClient, data: AuditInput) {
  await database.securityAudit.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60_000) } },
  })
  await database.securityAudit.create({ data })
}
