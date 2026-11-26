import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Adds up the AI credits every repository's scoring has spent since a moment. Spending is
 * counted when a score finishes, since one that resumes later is charged then.
 */
export async function sumLearningEvaluationCredits(
  database: Pick<PrismaClient, "learningEvaluationRun">,
  since: Date,
) {
  const total = await database.learningEvaluationRun.aggregate({
    where: { finishedAt: { gte: since } },
    _sum: { aiCredits: true },
  })
  return total._sum.aiCredits
}
