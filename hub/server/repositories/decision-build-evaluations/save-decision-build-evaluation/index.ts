import type { Prisma } from "../../../generated/prisma/client.ts"
import type { DecisionRuntimeUsage } from "../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"

export async function saveDecisionBuildEvaluation(
  database: Pick<Prisma.TransactionClient, "decisionBuildEvaluation">,
  input: {
    repositoryId: string
    buildId: string
    candidateId: string
    promotionGeneration: bigint
    questionDigest: string
    screenshotSetDigest: string
    runtimeEvaluationId?: string
    responseDigest: string
    summary: Prisma.InputJsonValue
    usage?: DecisionRuntimeUsage[]
  },
) {
  const where = {
    buildId_promotionGeneration_questionDigest_screenshotSetDigest: {
      buildId: input.buildId,
      promotionGeneration: input.promotionGeneration,
      questionDigest: input.questionDigest,
      screenshotSetDigest: input.screenshotSetDigest,
    },
  }
  const data = {
    repositoryId: input.repositoryId,
    buildId: input.buildId,
    candidateId: input.candidateId,
    promotionGeneration: input.promotionGeneration,
    questionDigest: input.questionDigest,
    screenshotSetDigest: input.screenshotSetDigest,
    runtimeEvaluationId: input.runtimeEvaluationId,
    responseDigest: input.responseDigest,
    summary: input.summary,
    usageRecords: (input.usage ?? []).map((record) => ({
      ...record,
    })) as Prisma.InputJsonArray,
  }
  const existing = await database.decisionBuildEvaluation.findUnique({ where })
  if (existing) {
    if (
      existing.repositoryId !== input.repositoryId ||
      existing.candidateId !== input.candidateId ||
      existing.responseDigest !== input.responseDigest
    ) {
      throw new Error("The decision Build evaluation reference is immutable.")
    }
    return existing
  }
  try {
    return await database.decisionBuildEvaluation.create({ data })
  } catch (error) {
    const raced = await database.decisionBuildEvaluation.findUnique({ where })
    if (
      raced &&
      raced.repositoryId === input.repositoryId &&
      raced.candidateId === input.candidateId &&
      raced.responseDigest === input.responseDigest
    ) {
      return raced
    }
    throw error
  }
}
