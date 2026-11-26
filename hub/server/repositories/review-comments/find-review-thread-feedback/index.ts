import type { Prisma } from "../../../generated/prisma/client.ts"

/** The thread's prototype, who gave its first comment, and when its Build started. */
export async function findReviewThreadFeedback(
  transaction: Pick<Prisma.TransactionClient, "reviewThread">,
  threadId: string,
) {
  const thread = await transaction.reviewThread.findUnique({
    where: { id: threadId },
    select: {
      repositoryId: true,
      prototypeId: true,
      build: { select: { workflowCreatedAt: true, createdAt: true } },
      comments: { where: { rootId: null }, select: { authorId: true }, take: 1 },
    },
  })
  if (!thread) return null
  return {
    repositoryId: thread.repositoryId,
    prototypeId: thread.prototypeId,
    authorId: thread.comments[0]?.authorId ?? null,
    buildStartedAt: thread.build.workflowCreatedAt ?? thread.build.createdAt,
  }
}
