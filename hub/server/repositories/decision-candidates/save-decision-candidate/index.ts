import type { Prisma } from "../../../generated/prisma/client.ts"
import type { DecisionRuntimeUsage } from "../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"

export async function saveDecisionCandidate(
  database: Pick<Prisma.TransactionClient, "decisionCandidate">,
  input: {
    repositoryId: string
    trainingJobId: string
    runtimeCandidateId: string
    tasksetDigest: string
    manifestDigest: string
    evaluationDigest: string
    productionEligible: boolean
    baselineMeanReward: number | null
    candidateMeanReward: number | null
    meanRewardDelta: number | null
    baselineCalibrationError: number | null
    candidateCalibrationError: number | null
    calibrationErrorDelta: number | null
    learningMetrics: Prisma.InputJsonValue
    durationSeconds?: number
    usage?: DecisionRuntimeUsage
  },
) {
  const data = {
    repositoryId: input.repositoryId,
    trainingJobId: input.trainingJobId,
    runtimeCandidateId: input.runtimeCandidateId,
    tasksetDigest: input.tasksetDigest,
    manifestDigest: input.manifestDigest,
    evaluationDigest: input.evaluationDigest,
    productionEligible: input.productionEligible,
    baselineMeanReward: input.baselineMeanReward,
    candidateMeanReward: input.candidateMeanReward,
    meanRewardDelta: input.meanRewardDelta,
    baselineCalibrationError: input.baselineCalibrationError,
    candidateCalibrationError: input.candidateCalibrationError,
    calibrationErrorDelta: input.calibrationErrorDelta,
    learningMetrics: input.learningMetrics,
    durationSeconds: input.durationSeconds,
    usageQuantity: input.usage?.quantity,
    usageUnit: input.usage?.unit,
    costAmount: input.usage?.cost?.amount,
    costCurrency: input.usage?.cost?.currency,
  }
  const existing = await database.decisionCandidate.findUnique({
    where: { trainingJobId: input.trainingJobId },
  })
  if (existing) {
    if (
      existing.repositoryId !== input.repositoryId ||
      existing.runtimeCandidateId !== input.runtimeCandidateId ||
      existing.tasksetDigest !== input.tasksetDigest ||
      existing.manifestDigest !== input.manifestDigest ||
      existing.evaluationDigest !== input.evaluationDigest
    ) {
      throw new Error("The decision candidate reference is immutable.")
    }
    return existing
  }
  try {
    return await database.decisionCandidate.create({ data })
  } catch (error) {
    const raced = await database.decisionCandidate.findUnique({
      where: { trainingJobId: input.trainingJobId },
    })
    if (
      raced &&
      raced.repositoryId === input.repositoryId &&
      raced.runtimeCandidateId === input.runtimeCandidateId &&
      raced.tasksetDigest === input.tasksetDigest &&
      raced.manifestDigest === input.manifestDigest &&
      raced.evaluationDigest === input.evaluationDigest
    ) {
      return raced
    }
    throw error
  }
}
