import type { Prisma } from "../../../generated/prisma/client.ts"

export async function readCanvasPrototype(
  database: Prisma.TransactionClient,
  repositoryId: string,
  branchName: string,
) {
  const buildFields = {
    number: true,
    commitSha: true,
    finishedAt: true,
    authorLogin: true,
    authorName: true,
    authorAvatarUrl: true,
  } satisfies Prisma.BuildSelect
  const prototype = await database.prototype.findFirst({
    where: { repositoryId, branchName, branchDeletedAt: null, replica: false },
    select: {
      id: true,
      canvasId: true,
      name: true,
      description: true,
      startPage: true,
      registeredAt: true,
      currentBuild: { select: { commitSha: true, state: true } },
      builds: {
        where: { state: "successful", commitSha: { not: null }, finishedAt: { not: null } },
        orderBy: { number: "desc" },
        take: 1,
        select: buildFields,
      },
      _count: { select: { builds: { where: { state: "successful" } } } },
    },
  })
  return prototype
}
