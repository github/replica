import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Captures the active owner, or latest retired owner, before asking GitHub about heads. */
export async function listGitHubBranchIdentities(
  database: PrismaClient,
  githubRepositoryId: number,
) {
  const prototypes = await database.prototype.findMany({
    where: {
      repository: { githubRepositoryId: BigInt(githubRepositoryId), removedAt: null },
    },
    orderBy: [
      { branchDeletedAt: { sort: "desc", nulls: "first" } },
      { branchPresenceRevision: "desc" },
      { id: "desc" },
    ],
    select: {
      id: true,
      branchName: true,
      branchDeletedAt: true,
      retiredHeadSha: true,
      branchPresenceRevision: true,
      branchHeadSha: true,
      branchIdentityStartedAt: true,
    },
  })
  const identities = new Map<string, (typeof prototypes)[number]>()
  for (const prototype of prototypes) {
    if (!identities.has(prototype.branchName)) identities.set(prototype.branchName, prototype)
  }
  return identities
}
