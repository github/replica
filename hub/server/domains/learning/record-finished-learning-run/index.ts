import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import { recordLearningActivityDay } from "../../../repositories/learning-activity-days/record-learning-activity-day/index.ts"

/**
 * Finishes a run and adds it to the daily activity summary in one transaction, so a
 * finished run is never missing from the activity grid.
 */
export function recordFinishedLearningRun(
  prisma: PrismaClient,
  runId: string,
  finish: (transaction: Prisma.TransactionClient) => Promise<{ count: number }>,
) {
  return prisma.$transaction(async (transaction) => {
    const result = await finish(transaction)
    if (result.count === 1) await recordLearningActivityDay(transaction, runId)
    return result
  })
}
