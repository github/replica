import type { Prisma } from "../../../generated/prisma/client.ts"

/** Replaces both tokens, so a stolen refresh token stops working after one use. */
export async function rotateAgentConnection(
  database: Pick<Prisma.TransactionClient, "agentConnection">,
  input: {
    clientId: string
    refreshDigest: string
    tokenDigest: string
    nextRefreshDigest: string
    expiresAt: Date
    inactiveAt: Date
  },
) {
  const now = new Date()
  const [connection] = await database.agentConnection.updateManyAndReturn({
    where: {
      clientId: input.clientId,
      refreshDigest: input.refreshDigest,
      revokedAt: null,
      inactiveAt: { gt: now },
    },
    data: {
      tokenDigest: input.tokenDigest,
      refreshDigest: input.nextRefreshDigest,
      expiresAt: input.expiresAt,
      inactiveAt: input.inactiveAt,
      lastUsedAt: now,
    },
    select: {
      id: true,
      membershipId: true,
      externalIdentityId: true,
      providerRevisionId: true,
      revocationRevision: true,
      expiresAt: true,
    },
  })
  return connection ?? null
}
