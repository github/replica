import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getDecisionTrainingJob(
  database: Pick<Prisma.TransactionClient, "decisionTrainingJob">,
  repositoryId: string,
  id: string,
) {
  return database.decisionTrainingJob.findFirst({ where: { id, repositoryId } })
}
