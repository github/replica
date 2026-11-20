import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function deleteDecisionAgentEvaluation(database: PrismaClient, id: string) {
  return database.decisionAgentEvaluation.deleteMany({ where: { id } })
}
