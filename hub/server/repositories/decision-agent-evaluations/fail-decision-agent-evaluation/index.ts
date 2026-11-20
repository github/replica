import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function failDecisionAgentEvaluation(database: PrismaClient, id: string) {
  return database.decisionAgentEvaluation.updateMany({
    where: { id, state: "PENDING" },
    data: { state: "FAILED" },
  })
}
