import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { PrivatePreviewAddress } from "../../../utils/private-preview-address/index.ts"

export async function findPrivatePreviewTarget(
  database: PrismaClient,
  address: PrivatePreviewAddress,
) {
  const matches = await database.build.findMany({
    where: {
      githubWorkflowRunId: BigInt(address.runId),
      prototype: {
        repository: { githubRepositoryId: BigInt(address.repositoryId) },
      },
    },
    take: 2,
    select: {
      id: true,
      state: true,
      artifacts: {
        where: { kind: "dist", path: "dist/index.html" },
        select: { id: true },
      },
      prototype: {
        select: {
          replica: true,
          branchName: true,
          startPage: true,
          repository: {
            select: { id: true, removedAt: true, localPath: true, defaultBranch: true },
          },
        },
      },
    },
  })
  const build = matches.length === 1 ? matches[0] : undefined
  if (!build || build.state !== "successful" || build.artifacts.length !== 1) return null
  const { prototype } = build
  if (
    prototype.replica ||
    prototype.repository.removedAt ||
    prototype.repository.localPath ||
    prototype.branchName === prototype.repository.defaultBranch ||
    prototype.branchName === "replica/install-workflow"
  )
    return null
  return {
    buildId: build.id,
    repositoryId: prototype.repository.id,
    startPage: prototype.startPage || "/",
  }
}
