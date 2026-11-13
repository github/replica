import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Replaces a membership's repository grants with the latest GitHub evidence.
 * Grants are derived from GitHub, so removing a stale grant loses no Hub data.
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
  await database.repositoryAccessGrant.deleteMany({
    where: { membershipId: input.membershipId, repositoryId: { notIn: input.repositoryIds } },
  })
  for (const repositoryId of new Set(input.repositoryIds)) {
    await database.repositoryAccessGrant.upsert({
      create: {
        id: input.createId(),
        membershipId: input.membershipId,
        observedAt: input.observedAt,
        repositoryId,
      },
      update: { observedAt: input.observedAt },
      where: {
        membershipId_repositoryId: { membershipId: input.membershipId, repositoryId },
      },
    })
  }
}
