import type { Prisma } from "../../../generated/prisma/client.ts"

export function findPendingAgentAuthorization(
  database: Pick<Prisma.TransactionClient, "agentAuthorization">,
  id: string,
) {
  return database.agentAuthorization.findFirst({
    where: { id, expiresAt: { gt: new Date() }, approvedAt: null, consumedAt: null },
    select: {
      id: true,
      redirectUri: true,
      state: true,
      expiresAt: true,
      client: { select: { name: true } },
    },
  })
}
