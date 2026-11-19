import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function findLocalPrototypeManagement(
  database: Pick<PrismaClient, "repository">,
  repositoryId: string,
) {
  const record = await database.repository.findFirst({
    where: { id: repositoryId, localPath: { not: null }, removedAt: null },
    select: {
      id: true,
      nameWithOwner: true,
      defaultBranch: true,
      prototypes: {
        where: {
          branchDeletedAt: null,
          replica: false,
          branchName: { not: "replica/install-workflow" },
        },
        orderBy: { branchName: "asc" },
        select: {
          id: true,
          branchName: true,
          name: true,
          description: true,
          startPage: true,
          registeredAt: true,
        },
      },
    },
  })
  if (!record) return null

  const { prototypes, ...repository } = record
  const branches = prototypes
    .filter(({ branchName }) => branchName !== repository.defaultBranch)
    .map(({ registeredAt, ...prototype }) => ({ registeredAt, prototype }))
  return {
    repository,
    canManage: true,
    registered: branches
      .filter(({ registeredAt }) => registeredAt !== null)
      .map(({ prototype }) => ({ ...prototype, canEdit: true })),
    candidates: branches
      .filter(({ registeredAt }) => registeredAt === null)
      .map(({ prototype }) => ({
        ...prototype,
        name: prototype.name ?? prototype.branchName,
      })),
  }
}
