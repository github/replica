import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Every active share from a repository Hub still lists, oldest first, with the source
 * repository's name and the sharer's login for display.
 */
export function listLearningShares(database: Pick<Prisma.TransactionClient, "learningShare">) {
  return database.learningShare.findMany({
    where: { withdrawnAt: null, repository: { removedAt: null } },
    orderBy: [{ sharedAt: "asc" }, { id: "asc" }],
    select: {
      repositoryId: true,
      learningId: true,
      sharedAt: true,
      repository: { select: { nameWithOwner: true } },
      sharedByMembership: {
        select: { user: { select: { profile: { select: { login: true } } } } },
      },
    },
  })
}
