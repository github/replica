import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function readHostedBuildRepository(
  database: PrismaClient,
  githubRepositoryId: bigint,
) {
  return database.repository.findFirst({
    where: { githubRepositoryId, removedAt: null, localPath: null },
    select: {
      id: true,
      githubRepositoryId: true,
      nameWithOwner: true,
      defaultBranch: true,
      hostedBranchScan: true,
    },
  })
}
