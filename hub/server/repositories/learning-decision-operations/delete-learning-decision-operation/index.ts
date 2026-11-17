import type { Prisma } from "../../../generated/prisma/client.ts"

export function deleteLearningDecisionOperation(
  database: Pick<Prisma.TransactionClient, "learningDecisionOperation">,
  operationId: string,
) {
  return database.learningDecisionOperation.deleteMany({ where: { id: operationId } })
}
