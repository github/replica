import type { Prisma } from "../../../generated/prisma/client.ts"
import { saveLearningReviewerVerification } from "../../../repositories/learning-reviewer-verifications/save-learning-reviewer-verification/index.ts"
import { recordLearningScoreRequest } from "../../../repositories/learning-score-requests/record-learning-score-request/index.ts"
import { findNewestSuccessfulBuildAfter } from "../../../repositories/prototypes/find-newest-successful-build-after/index.ts"
import { findReviewThreadFeedback } from "../../../repositories/review-comments/find-review-thread-feedback/index.ts"

/**
 * Asks for a fresh score when the person who gave review feedback resolves their own
 * thread. That is the clearest sign the change after their feedback worked. The newest
 * successful Build after the feedback Build stands in for the change. When there's no
 * later Build, nothing changed, so there's nothing to verify.
 */
export async function recordReviewerVerification(
  transaction: Pick<
    Prisma.TransactionClient,
    "build" | "learningReviewerVerification" | "learningScoreRequest" | "reviewThread"
  >,
  input: { threadId: string; resolverId: string; verifiedAt: Date },
) {
  const thread = await findReviewThreadFeedback(transaction, input.threadId)
  if (!thread || thread.authorId !== input.resolverId) return
  const later = await findNewestSuccessfulBuildAfter(transaction, {
    prototypeId: thread.prototypeId,
    after: thread.buildStartedAt,
  })
  if (!later) return
  await saveLearningReviewerVerification(transaction, {
    repositoryId: thread.repositoryId,
    prototypeId: thread.prototypeId,
    commitSha: later.commitSha,
    verifiedAt: input.verifiedAt,
  })
  await recordLearningScoreRequest(transaction, {
    repositoryId: thread.repositoryId,
    commitSha: later.commitSha,
  })
}
