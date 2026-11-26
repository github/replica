import type { Prisma } from "../../../generated/prisma/client.ts"

export function getDecisionReviewSnapshot(
  database: Pick<Prisma.TransactionClient, "decisionReviewSnapshot">,
  repositoryId: string,
) {
  return database.decisionReviewSnapshot.findUnique({
    where: { repositoryId },
    select: { digest: true, snapshotId: true, capturedAt: true },
  })
}
