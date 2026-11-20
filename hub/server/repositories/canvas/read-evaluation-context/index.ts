import type { Prisma } from "../../../generated/prisma/client.ts"

export async function readCanvasEvaluationContext(
  database: Prisma.TransactionClient,
  repositoryId: string,
  branchName: string,
  commitSha: string,
) {
  return database.prototype.findFirst({
    where: {
      repositoryId,
      branchName,
      branchDeletedAt: null,
      replica: false,
    },
    select: {
      id: true,
      builds: {
        where: {
          commitSha,
          state: "successful",
          finishedAt: { not: null },
        },
        orderBy: { number: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  })
}
