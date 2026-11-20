import { randomUUID } from "node:crypto"

import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"
import { DecisionModelError } from "../../../domains/decision-model/errors.ts"

export async function reserveDecisionAgentEvaluation(
  database: PrismaClient,
  input: {
    cacheKey: string
    candidateId: string
    promotionGeneration: number
    questionDigest: string
    repositoryId: string
    reservedCredits: number
    screenshotSetDigest: string
    ttlMs: number
  },
) {
  return database.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "decision_model_configurations"
        WHERE "repository_id" = ${input.repositoryId}::uuid
        FOR UPDATE
      `
      const now = new Date()
      const existing = await transaction.decisionAgentEvaluation.findUnique({
        where: { cacheKey: input.cacheKey },
      })
      if (existing?.result && existing.expiresAt > now) {
        return { status: "cached" as const, id: existing.id, result: existing.result }
      }
      if (existing && existing.expiresAt > now) {
        throw new DecisionModelError(
          409,
          "control_busy",
          "The same prototype evaluation is already running.",
        )
      }
      if (existing) {
        await transaction.decisionAgentEvaluation.delete({ where: { id: existing.id } })
      }
      const configuration = await transaction.decisionModelConfiguration.findUnique({
        where: { repositoryId: input.repositoryId },
        select: { enabled: true, monthlyBudgetCredits: true },
      })
      if (!configuration?.enabled) {
        throw new DecisionModelError(
          409,
          "configuration_disabled",
          "Decision-model evaluation is not enabled for this repository.",
        )
      }
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const [agentReserved, trainingReserved, trainingUsed] = await Promise.all([
        transaction.decisionAgentEvaluation.aggregate({
          where: { repositoryId: input.repositoryId, createdAt: { gte: month } },
          _sum: { reservedCredits: true },
        }),
        transaction.decisionTrainingJob.aggregate({
          where: {
            repositoryId: input.repositoryId,
            createdAt: { gte: month },
            state: { in: ["QUEUED", "SUBMITTING", "CANCEL_REQUESTED", "SUBMITTED", "RUNNING"] },
          },
          _sum: { budgetCredits: true },
        }),
        transaction.decisionTrainingJob.aggregate({
          where: {
            repositoryId: input.repositoryId,
            createdAt: { gte: month },
            state: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
            usageUnit: "credits",
          },
          _sum: { usageQuantity: true },
        }),
      ])
      if (
        Number(agentReserved._sum.reservedCredits?.toString() ?? "0") +
          Number(trainingReserved._sum.budgetCredits?.toString() ?? "0") +
          Number(trainingUsed._sum.usageQuantity?.toString() ?? "0") +
          input.reservedCredits >
        Number(configuration.monthlyBudgetCredits.toString())
      ) {
        throw new DecisionModelError(
          409,
          "budget_exceeded",
          "The repository decision-model budget has been reached.",
        )
      }
      const record = await transaction.decisionAgentEvaluation.create({
        data: {
          id: randomUUID(),
          cacheKey: input.cacheKey,
          candidateId: input.candidateId,
          promotionGeneration: BigInt(input.promotionGeneration),
          questionDigest: input.questionDigest,
          repositoryId: input.repositoryId,
          reservedCredits: new Prisma.Decimal(input.reservedCredits),
          screenshotSetDigest: input.screenshotSetDigest,
          expiresAt: new Date(now.getTime() + input.ttlMs),
        },
      })
      return { status: "reserved" as const, id: record.id }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
}
