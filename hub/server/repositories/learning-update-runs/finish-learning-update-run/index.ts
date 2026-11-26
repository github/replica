import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export function finishLearningUpdateRun(
  database: Pick<PrismaClient, "learningUpdateRun">,
  runId: string,
  input: {
    aiCredits: Prisma.Decimal | string
    copilotRequests: number
    finishedAt: Date
  } & ({ state: "SUCCEEDED"; result: string } | { state: "FAILED"; failureCode: string }),
) {
  return database.learningUpdateRun.updateMany({
    where: { id: runId, state: "RUNNING" },
    data: input,
  })
}
