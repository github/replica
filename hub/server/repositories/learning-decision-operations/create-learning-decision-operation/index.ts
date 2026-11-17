import type { Prisma } from "../../../generated/prisma/client.ts"

export function createLearningDecisionOperation(
  database: Pick<Prisma.TransactionClient, "learningDecisionOperation">,
  input: {
    id: string
    repositoryId: string
    actorMembershipId: string
    learningId: string
    decision: "accept" | "reject" | "retire"
  },
) {
  return database.learningDecisionOperation.create({ data: input })
}
