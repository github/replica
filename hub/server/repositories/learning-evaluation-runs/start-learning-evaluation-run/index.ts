import { randomUUID } from "node:crypto"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { LearningScoreTrigger } from "../../../generated/prisma/enums.ts"

/**
 * Starts scoring one used learning, or returns its earlier attempt. An attempt that never
 * finished keeps its operation ID, so retrying it can't store a second score. A reviewer's
 * verification is its own trigger, so it earns one more score without repeating the first.
 */
export function startLearningEvaluationRun(
  database: Pick<PrismaClient, "learningEvaluationRun">,
  input: { repositoryId: string; usedLearningId: string; trigger: LearningScoreTrigger },
) {
  return database.learningEvaluationRun.upsert({
    where: { repositoryId_usedLearningId_trigger: input },
    create: { ...input, operationId: randomUUID() },
    update: {},
  })
}
