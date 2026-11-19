import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Finds the Build for a commit on an active prototype branch without creating anything. */
export async function findGitHubBuild(
  database: PrismaClient,
  input: { githubRepositoryId: number; branchName: string; commitSha: string },
) {
  return database.build.findFirst({
    where: {
      commitSha: input.commitSha,
      prototype: {
        branchName: input.branchName,
        branchDeletedAt: null,
        repository: { githubRepositoryId: BigInt(input.githubRepositoryId), removedAt: null },
      },
    },
    select: { id: true },
  })
}
