import type { Prisma } from "../../../generated/prisma/client.ts"

export const analyticsAuthorizationScope = {
  id: true,
  repositoryId: true,
  hubSessionId: true,
  externalIdentityId: true,
  verifiedAt: true,
  attempt: {
    select: {
      purpose: true,
      providerRevisionId: true,
      sessionRevocationRevision: true,
      expiresAt: true,
      consumedAt: true,
    },
  },
} satisfies Prisma.AnalyticsDestinationAuthorizationSelect

export function findBoundAnalyticsCallback(
  tx: Prisma.TransactionClient,
  stateDigest: string,
  browserBindingDigest: string,
) {
  return tx.analyticsDestinationAuthorization.findFirst({
    where: { attempt: { stateDigest, browserBindingDigest, purpose: "REPOSITORY_ANALYTICS" } },
    select: analyticsAuthorizationScope,
  })
}

export function findAnalyticsAuthorization(
  tx: Prisma.TransactionClient,
  id: string,
  repositoryId: string,
) {
  return tx.analyticsDestinationAuthorization.findUnique({
    where: { id, repositoryId },
    select: analyticsAuthorizationScope,
  })
}

export function clearExpiredAnalyticsAuthorizations(tx: Prisma.TransactionClient) {
  const now = new Date()
  return tx.analyticsDestinationAuthorization.deleteMany({
    where: {
      OR: [
        { attempt: { expiresAt: { lte: now } } },
        { verifiedAt: { lte: new Date(now.getTime() - 5 * 60_000) } },
        { hubSession: { OR: [{ endedAt: { not: null } }, { expiresAt: { lte: now } }] } },
      ],
    },
  })
}
