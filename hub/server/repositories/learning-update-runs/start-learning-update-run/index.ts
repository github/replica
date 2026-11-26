import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function startLearningUpdateRun(
  database: Pick<PrismaClient, "learningUpdateRun">,
  input: { repositoryId: string; memoryId: string },
) {
  return database.learningUpdateRun.create({
    data: { repositoryId: input.repositoryId, memoryId: input.memoryId },
    select: { id: true },
  })
}
