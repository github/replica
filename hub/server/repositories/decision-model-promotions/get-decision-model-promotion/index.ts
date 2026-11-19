import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getDecisionModelPromotion(
  database: Pick<Prisma.TransactionClient, "decisionModelPromotion">,
  repositoryId: string,
) {
  return database.decisionModelPromotion.findFirst({
    where: { repositoryId },
    include: { candidate: true, previousCandidate: true },
    orderBy: [{ runtimeGeneration: "desc" }, { id: "desc" }],
  })
}
