import { randomUUID } from "node:crypto"

import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"

const monthlyRequestUnitLimit = 500

export async function reserveDecisionAgentEvaluation(
  database: PrismaClient,
  input: {
    cacheKey: string
    candidateId: string
    promotionGeneration: number
    questionDigest: string
    repositoryId: string
    requestUnits: number
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
      await transaction.decisionAgentEvaluation.updateMany({
        where: { expiresAt: { lte: now }, result: { not: Prisma.DbNull } },
        data: { result: Prisma.DbNull },
      })
      const existing = await transaction.decisionAgentEvaluation.findFirst({
        where: { cacheKey: input.cacheKey },
        orderBy: { createdAt: "desc" },
      })
      if (existing?.state === "COMPLETED" && existing.result && existing.expiresAt > now) {
        return { status: "cached" as const, id: existing.id, result: existing.result }
      }
      if (existing?.state === "PENDING" && existing.expiresAt > now) {
        return { status: "busy" as const }
      }
      const configuration = await transaction.decisionModelConfiguration.findUnique({
        where: { repositoryId: input.repositoryId },
        select: { enabled: true },
      })
      if (!configuration?.enabled) return { status: "disabled" as const }

      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const used = await transaction.decisionAgentEvaluation.aggregate({
        where: { repositoryId: input.repositoryId, createdAt: { gte: month } },
        _sum: { requestUnits: true },
      })
      if ((used._sum.requestUnits ?? 0) + input.requestUnits > monthlyRequestUnitLimit) {
        return { status: "budget-exhausted" as const }
      }
      const record = await transaction.decisionAgentEvaluation.create({
        data: {
          id: randomUUID(),
          cacheKey: input.cacheKey,
          candidateId: input.candidateId,
          promotionGeneration: BigInt(input.promotionGeneration),
          questionDigest: input.questionDigest,
          repositoryId: input.repositoryId,
          requestUnits: input.requestUnits,
          screenshotSetDigest: input.screenshotSetDigest,
          state: "PENDING",
          expiresAt: new Date(now.getTime() + input.ttlMs),
        },
      })
      return { status: "reserved" as const, id: record.id }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
}
