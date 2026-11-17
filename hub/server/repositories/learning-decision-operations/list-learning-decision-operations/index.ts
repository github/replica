import type { Prisma } from "../../../generated/prisma/client.ts"

export function listLearningDecisionOperations(
  database: Pick<Prisma.TransactionClient, "learningDecisionOperation">,
  limit = 100,
) {
  return database.learningDecisionOperation.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  })
}
