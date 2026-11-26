import type { Prisma } from "../../../generated/prisma/client.ts"

export function findAgentAuthorizationChallenge(
  database: Pick<Prisma.TransactionClient, "agentAuthorization">,
  clientId: string,
  codeDigest: string,
) {
  return database.agentAuthorization.findFirst({
    where: {
      clientId,
      codeDigest,
      approvedAt: { not: null },
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { codeChallenge: true },
  })
}
