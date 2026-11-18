import type { Prisma } from "../../../generated/prisma/client.ts"

export function failScheduledLearningRunEnqueue(
  database: Pick<Prisma.TransactionClient, "learningRun">,
  runId: string,
  finishedAt: Date,
) {
  return database.learningRun.updateMany({
    where: { id: runId, scheduled: true, state: "QUEUED" },
    data: {
      state: "FAILED",
      failureCode: "enqueue_failed",
      failureSummary: "Hub could not queue this scheduled learning run.",
      finishedAt,
    },
  })
}
