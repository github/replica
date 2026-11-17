import type { Prisma } from "../../../generated/prisma/client.ts"

export function listDeletedReviewComments(
  database: Pick<Prisma.TransactionClient, "reviewComment">,
  input: { after?: { deletedAt: Date; id: string }; limit?: number } = {},
) {
  const limit = input.limit ?? 100
  return database.reviewComment.findMany({
    where: {
      deletedAt: { not: null },
      learningRedactedAt: null,
      ...(input.after
        ? {
            OR: [
              { deletedAt: { gt: input.after.deletedAt } },
              { deletedAt: input.after.deletedAt, id: { gt: input.after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      publicId: true,
      id: true,
      deletedAt: true,
      authorLogin: true,
      learningRedactionActor: true,
      thread: { select: { repositoryId: true } },
    },
  })
}
