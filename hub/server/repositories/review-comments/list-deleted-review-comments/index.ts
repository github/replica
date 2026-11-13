import type { Prisma } from "../../../generated/prisma/client.ts"

export function listDeletedReviewComments(
  database: Pick<Prisma.TransactionClient, "reviewComment">,
  limit = 100,
) {
  return database.reviewComment.findMany({
    where: {
      deletedAt: { not: null },
      learningRedactedAt: null,
      thread: { repository: { removedAt: null } },
    },
    orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      publicId: true,
      authorLogin: true,
      learningRedactionActor: true,
      thread: { select: { repositoryId: true } },
    },
  })
}
