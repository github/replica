import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Replaces a membership's repository grants with the latest GitHub evidence.
 * Grants are derived from GitHub, so removing a stale grant loses no Hub data.
 * Uses a fixed number of queries regardless of how many repositories are granted.
 */
export async function replaceRepositoryAccessGrants(
  database: Pick<Prisma.TransactionClient, "repositoryAccessGrant">,
  input: {
    createId: () => string
    membershipId: string
    observedAt: Date
    repositoryIds: string[]
  },
): Promise<void> {
  const { membershipId, observedAt } = input
  const repositoryIds = [...new Set(input.repositoryIds)]
  await database.repositoryAccessGrant.deleteMany({
    where: { membershipId, repositoryId: { notIn: repositoryIds } },
  })
  const kept = await database.repositoryAccessGrant.findMany({
    select: { repositoryId: true },
    where: { membershipId },
  })
  if (kept.length) {
    await database.repositoryAccessGrant.updateMany({
      data: { observedAt },
      where: { membershipId },
    })
  }
  const keptIds = new Set(kept.map((grant) => grant.repositoryId))
  const missingIds = repositoryIds.filter((repositoryId) => !keptIds.has(repositoryId))
  if (missingIds.length) {
    await database.repositoryAccessGrant.createMany({
      data: missingIds.map((repositoryId) => ({
        id: input.createId(),
        membershipId,
        observedAt,
        repositoryId,
      })),
    })
  }
}
