import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function findGitHubBuildAuthorTarget(
  database: PrismaClient,
  input: { buildId: string; githubRepositoryId: number },
) {
  return database.build.findFirst({
    where: {
      id: input.buildId,
      githubWorkflowRunId: { not: null },
      commitSha: { not: null },
      prototype: {
        repository: {
          githubRepositoryId: BigInt(input.githubRepositoryId),
          removedAt: null,
        },
      },
    },
    select: { id: true, commitSha: true },
  })
}
