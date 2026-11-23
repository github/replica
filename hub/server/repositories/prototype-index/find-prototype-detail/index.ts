import { Prisma, type Build } from "../../../generated/prisma/client.ts"
import { trimPrototypeMetadata } from "../../../utils/trim-prototype-metadata/index.ts"
import { privatePreviewAddress } from "../../../utils/private-preview-address/index.ts"
import { type RepositoryScope, visibleRepositoryWhere } from "../visible-repository-where/index.ts"

const hiddenBranches = ["replica/install-workflow"]

export async function findPrototypeDetail(
  database: {
    $transaction<Result>(
      operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
      options: { isolationLevel: Prisma.TransactionIsolationLevel },
    ): Promise<Result>
    repository: Pick<Prisma.TransactionClient["repository"], "findFirst">
  },
  repositoryId: string,
  prototypeId: string,
  buildNumber?: number,
  buildPage?: { page: number; pageSize: number },
  scope: RepositoryScope = null,
  buildArtifactUrl?: (
    buildId: string,
    repositoryId: string,
    prototypeId: string,
    buildNumber: number,
    target: "preview" | "desktop" | "narrow",
  ) => string,
  privatePreviewHubOrigin?: string,
) {
  const detail = await database.$transaction(
    async (transaction) => {
      const repository = await transaction.repository.findFirst({
        where: { id: repositoryId, ...visibleRepositoryWhere(scope) },
        select: {
          id: true,
          nameWithOwner: true,
          defaultBranch: true,
          githubRepositoryId: true,
          localPath: true,
        },
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
          startPage: true,
          branchName: true,
          author: { select: { profile: { select: { login: true, name: true, provider: true } } } },
          currentBuildId: true,
        },
      })
      if (!prototype) return null

      // Prisma cannot page by workflow time with a stored-time fallback.
      const page = buildPage
        ? {
            numbers: (
              await transaction.$queryRaw<{ number: number }[]>(Prisma.sql`
                SELECT number FROM builds
                WHERE prototype_id = ${prototypeId}::uuid
                ORDER BY COALESCE(workflow_created_at, created_at) DESC, number DESC
                LIMIT ${buildPage.pageSize}
                OFFSET ${(buildPage.page - 1) * buildPage.pageSize}
              `)
            ).map(({ number }) => number),
            totalCount: await transaction.build.count({ where: { prototypeId } }),
          }
        : null
      const builds = await transaction.build.findMany({
        where: {
          prototypeId,
          ...(page
            ? {
                OR: [
                  { number: { in: page.numbers } },
                  ...(buildNumber ? [{ number: buildNumber, state: "successful" as const }] : []),
                ],
              }
            : {}),
        },
        select: {
          id: true,
          number: true,
          state: true,
          githubWorkflowRunId: true,
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
          artifacts: {
            where: {
              path: {
                in: [
                  "dist/index.html",
                  "dist/controls.replica.json",
                  "dist/replica-preview-base.json",
                  "screenshots/desktop.png",
                  "screenshots/narrow.png",
                ],
              },
            },
            select: { kind: true, path: true, storageKey: true },
          },
        },
      })
      builds.sort((first, second) => {
        const firstCreatedAt = (first.workflowCreatedAt ?? first.createdAt).getTime()
        const secondCreatedAt = (second.workflowCreatedAt ?? second.createdAt).getTime()
        return secondCreatedAt - firstCreatedAt || second.number - first.number
      })

      type HeaderBuild = Pick<
        Build,
        "number" | "state" | "authorLogin" | "authorName" | "authorProvider"
      >
      let latestBuild: HeaderBuild | null =
        builds.find(({ id }) => id === prototype.currentBuildId) ?? builds[0] ?? null
      if (page) {
        // The header describes the whole prototype, not only this page.
        latestBuild =
          (
            await transaction.$queryRaw<HeaderBuild[]>(Prisma.sql`
              SELECT number, state, author_login AS "authorLogin",
                author_name AS "authorName", author_provider AS "authorProvider" FROM builds
              WHERE prototype_id = ${prototypeId}::uuid
                AND (
                  ${prototype.currentBuildId}::uuid IS NULL
                  OR id = ${prototype.currentBuildId}::uuid
                )
              ORDER BY COALESCE(workflow_created_at, created_at) DESC, number DESC
              LIMIT 1
            `)
          )[0] ?? null
      }
      const successfulBuilds = builds.filter(({ state }) => state === "successful")
      const selectedBuild = buildNumber
        ? (successfulBuilds.find(({ number }) => number === buildNumber) ?? null)
        : (successfulBuilds[0] ?? null)
      const previewRunIds =
        privatePreviewHubOrigin && repository.githubRepositoryId && !repository.localPath
          ? successfulBuilds.flatMap(({ githubWorkflowRunId }) =>
              githubWorkflowRunId && githubWorkflowRunId > 0n ? [githubWorkflowRunId] : [],
            )
          : []
      const uniquePreviewRunIds = new Set(
        previewRunIds.length
          ? (
              await transaction.build.groupBy({
                by: ["githubWorkflowRunId"],
                // Include every Build in the repository, even outside this page or prototype.
                where: {
                  githubWorkflowRunId: { in: previewRunIds },
                  prototype: { repositoryId },
                },
                _count: { _all: true },
              })
            )
              .filter(({ _count }) => _count._all === 1)
              .map(({ githubWorkflowRunId }) => githubWorkflowRunId)
          : [],
      )
      const buildRecords = builds.map((build) => {
        const privateAddress =
          uniquePreviewRunIds.has(build.githubWorkflowRunId) &&
          build.state === "successful" &&
          build.artifacts.some(({ kind, path }) => kind === "dist" && path === "dist/index.html") &&
          build.artifacts.some(
            ({ kind, path }) => kind === "dist" && path === "dist/replica-preview-base.json",
          ) &&
          privatePreviewAddress(
            String(repository.githubRepositoryId),
            String(build.githubWorkflowRunId),
          )
        return {
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
          ...(privateAddress
            ? { privatePreviewUrl: `${privatePreviewHubOrigin}${privateAddress.launch}` }
            : {}),
          previewUrl:
            build.artifacts.some(({ path }) => path === "dist/index.html") && buildArtifactUrl
              ? buildArtifactUrl(
                  build.id,
                  prototype.repositoryId,
                  prototype.id,
                  build.number,
                  "preview",
                )
              : null,
          desktopScreenshotUrl:
            build.artifacts.some(({ path }) => path === "screenshots/desktop.png") &&
            buildArtifactUrl
              ? buildArtifactUrl(
                  build.id,
                  prototype.repositoryId,
                  prototype.id,
                  build.number,
                  "desktop",
                )
              : null,
          narrowScreenshotUrl:
            build.artifacts.some(({ path }) => path === "screenshots/narrow.png") &&
            buildArtifactUrl
              ? buildArtifactUrl(
                  build.id,
                  prototype.repositoryId,
                  prototype.id,
                  build.number,
                  "narrow",
                )
              : null,
        }
      })
      const selectedBuildRecord = selectedBuild
        ? (buildRecords.find(({ number }) => number === selectedBuild.number) ?? null)
        : null

      const controlsIdentity = selectedBuild?.artifacts.find(
        ({ path }) => path === "dist/controls.replica.json",
      )?.storageKey
      const authorBuild = latestBuild
      const author = prototype.author
        ? prototype.author.profile
        : authorBuild?.authorProvider === "github"
          ? {
              login: authorBuild.authorLogin,
              name: authorBuild.authorName,
              provider: authorBuild.authorProvider,
            }
          : null
      return {
        repository: {
          id: repository.id,
          nameWithOwner: repository.nameWithOwner,
          defaultBranch: repository.defaultBranch,
        },
        prototype: {
          id: prototype.id,
          repositoryId: prototype.repositoryId,
          name: prototype.name?.trim() || prototype.branchName,
          branchName: prototype.branchName,
          description: prototype.description,
          startPage: (prototype.startPage && trimPrototypeMetadata(prototype.startPage)) || "/",
          authorLogin: author?.login ?? null,
          authorName: author?.name ?? null,
          authorProvider: author?.provider ?? null,
          canEdit: false,
          latestBuild: latestBuild
            ? { number: latestBuild.number, state: latestBuild.state }
            : null,
          builds: buildRecords,
        },
        selectedBuild: selectedBuildRecord,
        ...(controlsIdentity ? { controlsIdentity } : {}),
        ...(page
          ? {
              buildPage: {
                builds: buildRecords.filter(({ number }) => page.numbers.includes(number)),
                totalCount: page.totalCount,
              },
            }
          : {}),
      }
    },
    { isolationLevel: "RepeatableRead" },
  )
  if (!detail) return null

  const currentRepository = await database.repository.findFirst({
    where: {
      id: repositoryId,
      ...visibleRepositoryWhere(scope),
      defaultBranch: detail.repository.defaultBranch,
    },
    select: { id: true },
  })
  return currentRepository ? detail : null
}
