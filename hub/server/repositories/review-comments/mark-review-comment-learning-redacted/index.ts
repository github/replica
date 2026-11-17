import type { Prisma } from "../../../generated/prisma/client.ts"

export function markReviewCommentLearningRedacted(
  database: Pick<Prisma.TransactionClient, "reviewComment">,
  input: { repositoryId: string; commentId: number; redactedAt: Date },
) {
  return database.reviewComment.updateMany({
    where: {
      publicId: input.commentId,
      deletedAt: { not: null },
      learningRedactedAt: null,
      thread: { repositoryId: input.repositoryId },
    },
    data: { learningRedactedAt: input.redactedAt },
  })
}
