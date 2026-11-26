import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Closes update checks left running by a stopped worker. The package can't resume a
 * check, so they are recorded as interrupted.
 */
export function closeAbandonedLearningUpdateRuns(
  database: Pick<PrismaClient, "learningUpdateRun">,
  finishedAt: Date,
) {
  return database.learningUpdateRun.updateMany({
    where: { state: "RUNNING" },
    data: { state: "FAILED", failureCode: "interrupted", finishedAt },
  })
}
