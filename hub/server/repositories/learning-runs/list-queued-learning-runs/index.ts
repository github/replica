import type { Prisma } from "../../../generated/prisma/client.ts"

export function listQueuedLearningRuns(
  database: Pick<Prisma.TransactionClient, "learningRun">,
  limit = 100,
) {
  return database.learningRun.findMany({
    where: { state: "QUEUED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  })
}
