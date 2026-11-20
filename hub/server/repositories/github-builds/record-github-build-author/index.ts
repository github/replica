import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { getGitHubBuildAuthorAction } from "../../../utils/get-github-build-author-action/index.ts"

/** Repairs author metadata without changing Build ownership, artifacts, or selection. */
export async function recordGitHubBuildAuthor(
  database: PrismaClient,
  input: {
    buildId: string
    commitSha: string
    githubRepositoryId: number
    githubWorkflowRunId: bigint | null
    author: { providerUserId: string; login: string | null; avatarUrl: string | null }
  },
) {
  return database.$transaction(async (transaction) => {
    const [repository] = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "repositories"
      WHERE "github_repository_id" = ${BigInt(input.githubRepositoryId)}
        AND "removed_at" IS NULL
      FOR SHARE
    `
    if (!repository) throw new Error("The GitHub repository is no longer connected.")
    const [build] = await transaction.$queryRaw<
      Array<{
        authorProvider: string | null
        authorIssuer: string | null
        authorProviderUserId: string | null
        authorLogin: string | null
        authorName: string | null
        authorAvatarUrl: string | null
      }>
    >`
      SELECT builds."author_provider" AS "authorProvider",
        builds."author_issuer" AS "authorIssuer",
        builds."author_provider_user_id" AS "authorProviderUserId",
        builds."author_login" AS "authorLogin",
        builds."author_name" AS "authorName",
        builds."author_avatar_url" AS "authorAvatarUrl"
      FROM "builds"
      INNER JOIN "prototypes" ON prototypes."id" = builds."prototype_id"
      WHERE builds."id" = ${input.buildId}::uuid
        AND builds."commit_sha" = ${input.commitSha}
        AND builds."github_workflow_run_id" IS NOT DISTINCT FROM ${input.githubWorkflowRunId}::bigint
        AND prototypes."repository_id" = ${repository.id}::uuid
      FOR UPDATE OF builds
    `
    if (!build) throw new Error("The Build no longer matches the repository, commit, and run.")
    const action = getGitHubBuildAuthorAction(build, input.author)
    if (action === "would-update") {
      await transaction.build.update({
        where: { id: input.buildId },
        data: {
          authorProvider: "github",
          authorIssuer: "https://github.com",
          authorProviderUserId: input.author.providerUserId,
          authorLogin: input.author.login,
          authorAvatarUrl: input.author.avatarUrl,
        },
      })
    }
    return { status: action === "would-update" ? ("updated" as const) : action }
  })
}
