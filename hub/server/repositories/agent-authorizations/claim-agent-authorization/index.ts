import type { Prisma } from "../../../generated/prisma/client.ts"

/** Uses an approved code exactly once, even when two exchanges race. */
export async function claimAgentAuthorization(
  database: Pick<Prisma.TransactionClient, "agentAuthorization">,
  clientId: string,
  codeDigest: string,
) {
  const now = new Date()
  const [claimed] = await database.agentAuthorization.updateManyAndReturn({
    where: {
      clientId,
      codeDigest,
      approvedAt: { not: null },
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
    select: {
      id: true,
      redirectUri: true,
      session: {
        select: {
          id: true,
          membershipId: true,
          externalIdentityId: true,
          providerRevisionId: true,
          revocationRevision: true,
          endedAt: true,
          expiresAt: true,
        },
      },
    },
  })
  return claimed ?? null
}
