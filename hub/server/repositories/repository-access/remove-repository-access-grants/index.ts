import type { Prisma } from "../../../generated/prisma/client.ts"

export async function removeRepositoryAccessGrants(
  database: Pick<
    Prisma.TransactionClient,
    "externalIdentity" | "membership" | "repositoryAccessGrant"
  >,
  input: { githubRepositoryIds: Array<number | bigint> | "all"; githubUserId?: number },
): Promise<{ emptiedMembershipIds: string[] }> {
  let membershipIds: string[]
  if (input.githubUserId !== undefined) {
    const identities = await database.externalIdentity.findMany({
      select: { userId: true },
      where: { provider: "github", subject: String(input.githubUserId) },
    })
    const memberships = await database.membership.findMany({
      select: { id: true },
      where: { userId: { in: identities.map((identity) => identity.userId) } },
    })
    membershipIds = memberships.map((membership) => membership.id)
  } else {
    const affected = await database.repositoryAccessGrant.findMany({
      select: { membershipId: true },
      where:
        input.githubRepositoryIds === "all"
          ? {}
          : { repository: { githubRepositoryId: { in: input.githubRepositoryIds.map(BigInt) } } },
    })
    membershipIds = [...new Set(affected.map((grant) => grant.membershipId))]
  }
  if (!membershipIds.length) return { emptiedMembershipIds: [] }
  await database.repositoryAccessGrant.deleteMany({
    where: {
      membershipId: { in: membershipIds },
      ...(input.githubRepositoryIds === "all"
        ? {}
        : { repository: { githubRepositoryId: { in: input.githubRepositoryIds.map(BigInt) } } }),
    },
  })
  const remaining = await database.repositoryAccessGrant.groupBy({
    by: ["membershipId"],
    where: { membershipId: { in: membershipIds }, repository: { removedAt: null } },
  })
  const withGrants = new Set(remaining.map((grant) => grant.membershipId))
  return { emptiedMembershipIds: membershipIds.filter((id) => !withGrants.has(id)) }
}
