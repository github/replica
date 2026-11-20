import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function findPathPreviewTargets(
  database: PrismaClient,
  input: { githubRepositoryId: string; githubWorkflowRunId: string },
) {
  const builds = await database.build.findMany({
    where: {
      state: "successful",
      githubWorkflowRunId: BigInt(input.githubWorkflowRunId),
      artifacts: { some: { kind: "dist", path: "dist/index.html" } },
      prototype: {
        branchDeletedAt: null,
        branchName: { not: "replica/install-workflow" },
        repository: {
          githubRepositoryId: BigInt(input.githubRepositoryId),
          removedAt: null,
          localPath: null,
        },
      },
    },
    take: 2,
    select: {
      id: true,
      prototype: {
        select: {
          replica: true,
          branchName: true,
          repository: { select: { id: true, defaultBranch: true } },
        },
      },
    },
  })
  if (
    builds.length === 1 &&
    builds[0]!.prototype.replica &&
    builds[0]!.prototype.branchName !== builds[0]!.prototype.repository.defaultBranch
  )
    return []
  return builds.map(({ id, prototype }) => {
    const template = prototype.branchName === prototype.repository.defaultBranch
    return { buildId: id, repository: { id: prototype.repository.id, local: false }, template }
  })
}
