import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Keeps when a reviewer confirmed one prototype's commit. It lives apart from the score
 * request, so usage reported later for the same commit still gets the confirmation.
 */
export function saveLearningReviewerVerification(
  transaction: Pick<Prisma.TransactionClient, "learningReviewerVerification">,
  input: { repositoryId: string; prototypeId: string; commitSha: string; verifiedAt: Date },
) {
  return transaction.learningReviewerVerification.upsert({
    where: {
      prototypeId_commitSha: { prototypeId: input.prototypeId, commitSha: input.commitSha },
    },
    create: input,
    update: { verifiedAt: input.verifiedAt },
  })
}
