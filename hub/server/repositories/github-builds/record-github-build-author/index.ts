import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { PrepareGitHubBuildInput } from "../prepare-github-build/types.ts"

/** Repairs author metadata without changing Build ownership, artifacts, or selection. */
export async function recordGitHubBuildAuthor(
  database: PrismaClient,
  input: {
    buildId: string
    commitSha: string
    author: NonNullable<PrepareGitHubBuildInput["author"]>
  },
) {
  return database.$transaction(async (transaction) => {
    const build = await transaction.build.findFirst({
      where: { id: input.buildId, commitSha: input.commitSha },
      select: {
        prototypeId: true,
        authorProvider: true,
        authorIssuer: true,
        authorProviderUserId: true,
      },
    })
    if (!build) throw new Error("The Build does not match the resolved GitHub commit.")
    if (
      build.authorProvider !== null &&
      (build.authorProvider !== "github" ||
        build.authorIssuer !== "https://github.com" ||
        build.authorProviderUserId !== input.author.providerUserId)
    ) {
      return { status: "preserved" as const }
    }
    const written = await transaction.build.updateMany({
      where: {
        id: input.buildId,
        authorProvider: null,
        authorIssuer: null,
        authorProviderUserId: null,
      },
      data: {
        authorProvider: "github",
        authorIssuer: "https://github.com",
        authorProviderUserId: input.author.providerUserId,
        authorLogin: input.author.login,
        authorAvatarUrl: input.author.avatarUrl,
      },
    })
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
    if (!identity) return { status: written.count ? ("updated" as const) : ("unchanged" as const) }
    const linked = await transaction.prototype.updateMany({
      where: {
        id: build.prototypeId,
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
    return { status: written.count || linked.count ? ("updated" as const) : ("unchanged" as const) }
  })
}
