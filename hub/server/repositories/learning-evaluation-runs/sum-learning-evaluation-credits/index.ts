import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Adds up the AI credits every repository's scoring and update suggestions have spent
 * since a moment, since both draw on the same monthly budget. Spending is counted when an
 * attempt finishes, since one that resumes later is charged then.
 */
export async function sumLearningEvaluationCredits(
  database: Pick<PrismaClient, "learningEvaluationRun" | "learningUpdateRun">,
  since: Date,
) {
  const [scores, updates] = await Promise.all([
    database.learningEvaluationRun.aggregate({
      where: { finishedAt: { gte: since } },
      _sum: { aiCredits: true },
    }),
    database.learningUpdateRun.aggregate({
      where: { finishedAt: { gte: since } },
      _sum: { aiCredits: true },
    }),
  ])
  if (!scores._sum.aiCredits && !updates._sum.aiCredits) return null
  return new Prisma.Decimal(scores._sum.aiCredits ?? 0).plus(updates._sum.aiCredits ?? 0)
}
