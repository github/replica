import type { Prisma } from "../../../generated/prisma/client.ts"

export function updateLearningRunProgress(
  database: Pick<Prisma.TransactionClient, "learningRun">,
  runId: string,
  input: {
    commentsConsidered: number
    commentsLabeled: number
    commentsRemaining: number
    copilotRequests: number
    aiCredits: string
  },
) {
  return database.learningRun.updateMany({
    where: { id: runId, state: "RUNNING" },
    data: input,
  })
}
