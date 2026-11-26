import { randomUUID } from "node:crypto"

import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Starts scoring one used learning, or returns its earlier attempt. An attempt that never
 * finished keeps its operation ID, so retrying it can't store a second score.
 */
export function startLearningEvaluationRun(
  database: Pick<PrismaClient, "learningEvaluationRun">,
  input: { repositoryId: string; usedLearningId: string },
) {
  return database.learningEvaluationRun.upsert({
    where: { repositoryId_usedLearningId: input },
    create: { ...input, operationId: randomUUID() },
    update: {},
  })
}
