import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Replaces a membership's repository grants and access levels with the latest GitHub evidence.
 * Grants are derived from GitHub, so removing a stale grant loses no Hub data.
 * Uses a fixed number of queries regardless of how many repositories are granted.
 */
export async function replaceRepositoryAccessGrants(
  database: Pick<Prisma.TransactionClient, "repositoryAccessGrant">,
  input: {
    createId: () => string
    membershipId: string
    observedAt: Date
    repositories: Array<{
      accessLevel: "READ" | "TRIAGE" | "WRITE" | "MAINTAIN" | "ADMIN"
      repositoryId: string
    }>
  },
): Promise<void> {
  const { membershipId, observedAt } = input
  const repositories = [
    ...new Map(
      input.repositories.map((repository) => [repository.repositoryId, repository]),
    ).values(),
  ]
  await database.repositoryAccessGrant.deleteMany({ where: { membershipId } })
  if (repositories.length) {
    await database.repositoryAccessGrant.createMany({
      data: repositories.map((repository) => ({
        accessLevel: repository.accessLevel,
        id: input.createId(),
        membershipId,
        observedAt,
        repositoryId: repository.repositoryId,
      })),
    })
  }
}
