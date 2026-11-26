import type { Prisma } from "../../../generated/prisma/client.ts"

/** Finds the connection for an access token and pushes back its inactivity limit. */
export async function touchAgentConnection(
  database: Pick<Prisma.TransactionClient, "agentConnection">,
  tokenDigest: string,
  inactiveAt: Date,
) {
  const now = new Date()
  const [connection] = await database.agentConnection.updateManyAndReturn({
    where: { tokenDigest, revokedAt: null, expiresAt: { gt: now }, inactiveAt: { gt: now } },
    data: { lastUsedAt: now, inactiveAt },
    select: {
      id: true,
      clientId: true,
      membershipId: true,
      externalIdentityId: true,
      providerRevisionId: true,
      revocationRevision: true,
      expiresAt: true,
    },
  })
  return connection ?? null
}
