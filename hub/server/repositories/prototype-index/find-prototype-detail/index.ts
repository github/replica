import type { PrismaClient } from "../../../generated/prisma/client.ts"

const hiddenBranches = ["replica/install-workflow"]

export async function findPrototypeDetail(
  database: Pick<PrismaClient, "$transaction" | "repository">,
  repositoryId: string,
  prototypeId: string,
  buildNumber?: number,
) {
  const detail = await database.$transaction(
    async (transaction) => {
      const repository = await transaction.repository.findFirst({
        where: { id: repositoryId, removedAt: null },
        select: { id: true, nameWithOwner: true, defaultBranch: true },
      })
      if (!repository) return null

      const prototype = await transaction.prototype.findFirst({
        where: {
          id: prototypeId,
          repositoryId,
          replica: false,
          branchName: { notIn: [repository.defaultBranch, ...hiddenBranches] },
        },
        select: {
          id: true,
          repositoryId: true,
          name: true,
          description: true,
          branchName: true,
          author: { select: { profile: { select: { login: true, name: true, provider: true } } } },
          currentBuildId: true,
        },
      })
      if (!prototype) return null

      const builds = await transaction.build.findMany({
        where: { prototypeId },
        select: {
          id: true,
          number: true,
          state: true,
          commitSha: true,
          authorProvider: true,
          authorIssuer: true,
          authorProviderUserId: true,
          authorLogin: true,
          authorName: true,
          authorAvatarUrl: true,
          createdAt: true,
          workflowCreatedAt: true,
          startedAt: true,
          finishedAt: true,
          failureSummary: true,
        },
      })
      builds.sort((first, second) => {
        const firstCreatedAt = (first.workflowCreatedAt ?? first.createdAt).getTime()
        const secondCreatedAt = (second.workflowCreatedAt ?? second.createdAt).getTime()
        return secondCreatedAt - firstCreatedAt || second.number - first.number
      })

      const latestBuild =
        builds.find(({ id }) => id === prototype.currentBuildId) ?? builds[0] ?? null
      const successfulBuilds = builds.filter(({ state }) => state === "successful")
      const selectedBuild = buildNumber
        ? (successfulBuilds.find(({ number }) => number === buildNumber) ?? null)
        : (successfulBuilds[0] ?? null)
      const buildRecords = builds.map((build) => ({
        number: build.number,
        state: build.state,
        commitSha: build.commitSha,
        commitAuthorProvider: build.authorProvider,
        commitAuthorIssuer: build.authorIssuer,
        commitAuthorProviderUserId: build.authorProviderUserId,
        commitAuthorLogin: build.authorLogin,
        commitAuthorName: build.authorName,
        commitAuthorAvatarUrl: build.authorAvatarUrl,
        createdAt: build.createdAt,
        startedAt: build.startedAt,
        finishedAt: build.finishedAt,
        failureSummary: build.failureSummary,
        repositoryId: prototype.repositoryId,
        prototypeId: prototype.id,
        previewUrl: null,
        desktopScreenshotUrl: null,
        narrowScreenshotUrl: null,
      }))
      const selectedBuildRecord = selectedBuild
        ? (buildRecords.find(({ number }) => number === selectedBuild.number) ?? null)
        : null

      return {
        repository,
        prototype: {
          id: prototype.id,
          repositoryId: prototype.repositoryId,
          name: prototype.name?.trim() || prototype.branchName,
          branchName: prototype.branchName,
          description: prototype.description,
          authorLogin: prototype.author?.profile?.login ?? null,
          authorName: prototype.author?.profile?.name ?? null,
          authorProvider: prototype.author?.profile?.provider ?? null,
          canEdit: false,
          latestBuild: latestBuild
            ? { number: latestBuild.number, state: latestBuild.state }
            : null,
          builds: buildRecords,
        },
        selectedBuild: selectedBuildRecord,
      }
    },
    { isolationLevel: "RepeatableRead" },
  )
  if (!detail) return null

  const currentRepository = await database.repository.findFirst({
    where: {
      id: repositoryId,
      removedAt: null,
      defaultBranch: detail.repository.defaultBranch,
    },
    select: { id: true },
  })
  return currentRepository ? detail : null
}
