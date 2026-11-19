import type { Prisma } from "../../../generated/prisma/client.ts"

export async function requestDecisionTrainingCancellation(
  database: Pick<Prisma.TransactionClient, "decisionTrainingJob">,
  id: string,
) {
  const cancelled = await database.decisionTrainingJob.updateMany({
    where: { id, state: "QUEUED", runtimeJobId: null },
    data: {
      state: "CANCELLED",
      usageQuantity: 0,
      usageUnit: "credits",
      usageRecords: [],
      finishedAt: new Date(),
    },
  })
  const requested =
    cancelled.count === 0
      ? await database.decisionTrainingJob.updateMany({
          where: { id, state: "SUBMITTING", runtimeJobId: null },
          data: { state: "CANCEL_REQUESTED" },
        })
      : { count: 0 }
  return {
    changed: cancelled.count === 1 || requested.count === 1,
    terminal: cancelled.count === 1,
    job: await database.decisionTrainingJob.findUniqueOrThrow({ where: { id } }),
  }
}
