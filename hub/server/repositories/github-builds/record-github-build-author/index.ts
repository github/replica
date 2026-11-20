import type { PrismaClient } from "../../../generated/prisma/client.ts"

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
        prototypeId: string
        authorProvider: string | null
        authorIssuer: string | null
        authorProviderUserId: string | null
        authorLogin: string | null
        authorName: string | null
        authorAvatarUrl: string | null
      }>
    >`
      SELECT builds."prototype_id" AS "prototypeId",
        builds."author_provider" AS "authorProvider",
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
    const noIdentity =
      build.authorProvider === null &&
      build.authorIssuer === null &&
      build.authorProviderUserId === null
    const sameIdentity =
      build.authorProvider === "github" &&
      build.authorIssuer === "https://github.com" &&
      build.authorProviderUserId === input.author.providerUserId
    if (
      (!noIdentity && !sameIdentity) ||
      (noIdentity &&
        (build.authorLogin !== null || build.authorName !== null || build.authorAvatarUrl !== null))
    ) {
      return { status: "preserved" as const }
    }
    if (noIdentity && !input.author.login) {
      throw new Error("A GitHub author login is required to record a new identity.")
    }
    if (noIdentity) {
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
    const identity = await transaction.externalIdentity.findUnique({
      where: {
        provider_issuer_subject: {
          provider: "github",
          issuer: "https://github.com",
          subject: input.author.providerUserId,
        },
      },
      select: { userId: true },
    })
    if (!identity) return { status: noIdentity ? ("updated" as const) : ("unchanged" as const) }
    const linked = await transaction.prototype.updateMany({
      where: {
        id: build.prototypeId,
        repositoryId: repository.id,
        authorId: null,
        builds: {
          some: {
            id: input.buildId,
            authorProvider: "github",
            authorIssuer: "https://github.com",
            authorProviderUserId: input.author.providerUserId,
          },
        },
      },
      data: { authorId: identity.userId },
    })
    return { status: noIdentity || linked.count ? ("updated" as const) : ("unchanged" as const) }
  })
}
