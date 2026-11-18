import type { DecisionPromotionOperation, Prisma } from "../../../generated/prisma/client.ts"

export async function saveDecisionModelPromotion(
  database: Pick<Prisma.TransactionClient, "decisionModelPromotion">,
  input: {
    repositoryId: string
    candidateId: string
    previousCandidateId: string | null
    promotedByMembershipId: string
    runtimeGeneration: bigint
    operation: DecisionPromotionOperation
  },
) {
  return database.decisionModelPromotion.create({
    data: input,
    include: { candidate: true, previousCandidate: true },
  })
}
