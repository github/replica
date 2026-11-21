import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function findPathPreviewTargets(
  database: PrismaClient,
  input: { githubRepositoryId: string; githubWorkflowRunId: string },
) {
  const builds = await database.build.findMany({
    where: {
      state: "successful",
      githubWorkflowRunId: BigInt(input.githubWorkflowRunId),
      prototype: {
        repository: {
          githubRepositoryId: BigInt(input.githubRepositoryId),
        },
      },
    },
    take: 2,
    select: {
      id: true,
      artifacts: { where: { kind: "dist", path: "dist/index.html" }, select: { id: true } },
      prototype: {
        select: {
          replica: true,
          branchDeletedAt: true,
          branchName: true,
          repository: {
            select: { id: true, defaultBranch: true, removedAt: true, localPath: true },
          },
        },
      },
    },
  })
  if (builds.length === 1) {
    const { prototype, artifacts } = builds[0]!
    if (
      artifacts.length === 0 ||
      prototype.branchDeletedAt ||
      prototype.branchName === "replica/install-workflow" ||
      prototype.repository.removedAt ||
      prototype.repository.localPath ||
      (prototype.replica && prototype.branchName !== prototype.repository.defaultBranch)
    )
      return []
  }
  return builds.map(({ id, prototype }) => {
    const template = prototype.branchName === prototype.repository.defaultBranch
    return {
      buildId: id,
      repository: { id: prototype.repository.id, local: Boolean(prototype.repository.localPath) },
      template,
    }
  })
}
