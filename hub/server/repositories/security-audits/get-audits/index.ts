import type { Prisma } from "../../../generated/prisma/client.ts"

export function getSecurityAudits(database: Prisma.TransactionClient) {
  return database.securityAudit.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60_000) } },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
}
