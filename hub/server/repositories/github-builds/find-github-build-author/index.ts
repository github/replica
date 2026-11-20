import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function findGitHubBuildAuthor(
  database: PrismaClient,
  input: { buildId: string; commitSha: string; githubRepositoryId: number },
) {
  return database.build.findFirst({
    where: {
      id: input.buildId,
      commitSha: input.commitSha,
      prototype: {
        repository: { githubRepositoryId: BigInt(input.githubRepositoryId), removedAt: null },
      },
    },
    select: {
      githubWorkflowRunId: true,
      authorProvider: true,
      authorIssuer: true,
      authorProviderUserId: true,
      authorLogin: true,
      authorAvatarUrl: true,
    },
  })
}
