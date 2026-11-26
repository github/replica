import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export function finishLearningEvaluationRun(
  database: Pick<PrismaClient, "learningEvaluationRun">,
  runId: string,
  input: {
    aiCredits: Prisma.Decimal | string
    copilotRequests: number
    finishedAt: Date
  } & ({ state: "SUCCEEDED"; scoreId: string } | { state: "FAILED"; failureCode: string }),
) {
  return database.learningEvaluationRun.updateMany({
    where: { id: runId, state: "RUNNING" },
    data: input,
  })
}
