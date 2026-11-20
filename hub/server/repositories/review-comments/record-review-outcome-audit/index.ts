import type { Prisma } from "../../../generated/prisma/client.ts"
import type { ReviewOutcomeKind } from "../../../domains/review-comments/types.ts"

export async function recordReviewOutcomeAudit(
  database: Pick<Prisma.TransactionClient, "securityAudit">,
  input: {
    repositoryId: string
    actorMembershipId: string | null
    outcomeId: string
    threadId: string
    buildId: string
    kind: ReviewOutcomeKind
  },
) {
  await database.securityAudit.create({
    data: {
      repositoryId: input.repositoryId,
      action: "review.outcome.recorded",
      outcome: "SUCCESS",
      targetType: "review_outcome",
      targetId: input.outcomeId,
      context: {
        ...(input.actorMembershipId ? { actorMembershipId: input.actorMembershipId } : {}),
        threadId: input.threadId,
        buildId: input.buildId,
        kind: input.kind,
      },
    },
  })
}
