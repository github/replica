import type { Prisma } from "../../../generated/prisma/client.ts"

export function finishLearningRun(
  database: Pick<Prisma.TransactionClient, "learningRun">,
  runId: string,
  input:
    | {
        state: "SUCCEEDED"
        suggestions: number
        suggestionsRemaining: number
        finishedAt: Date
      }
    | {
        state: "FAILED"
        failureCode: string
        failureSummary: string
        finishedAt: Date
      },
) {
  return database.learningRun.updateMany({
    where: { id: runId, state: { in: ["QUEUED", "RUNNING"] } },
    data: input,
  })
}
