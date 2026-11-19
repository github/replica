import type { Prisma } from "../../../generated/prisma/client.ts"

export async function markDecisionTrainingSubmitting(
  database: Pick<Prisma.TransactionClient, "decisionTrainingJob">,
  id: string,
) {
  await database.decisionTrainingJob.updateMany({
    where: { id, state: "QUEUED", runtimeJobId: null },
    data: { state: "SUBMITTING" },
  })
  return database.decisionTrainingJob.findUniqueOrThrow({ where: { id } })
}
