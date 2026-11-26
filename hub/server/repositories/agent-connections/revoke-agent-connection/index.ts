import type { Prisma } from "../../../generated/prisma/client.ts"

/** Ends one connection, found by either of its tokens or by its owner. */
export async function revokeAgentConnection(
  database: Pick<Prisma.TransactionClient, "agentConnection">,
  where:
    | { clientId: string; tokenDigest: string }
    | { clientId: string; refreshDigest: string }
    | { id: string; membershipId: string; externalIdentityId: string },
) {
  const [revoked] = await database.agentConnection.updateManyAndReturn({
    where: { ...where, revokedAt: null },
    data: { revokedAt: new Date() },
    select: { id: true, membershipId: true },
  })
  return revoked ?? null
}
