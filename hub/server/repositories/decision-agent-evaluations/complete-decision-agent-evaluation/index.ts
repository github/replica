import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function completeDecisionAgentEvaluation(
  database: PrismaClient,
  input: { id: string; result: object },
) {
  return database.decisionAgentEvaluation.update({
    where: { id: input.id },
    data: { result: input.result },
  })
}
