import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"

import { saveDecisionBuildEvaluation } from "../../../repositories/decision-build-evaluations/save-decision-build-evaluation/index.ts"
import { getDecisionCandidate } from "../../../repositories/decision-candidates/get-decision-candidate/index.ts"
import { saveDecisionCandidate } from "../../../repositories/decision-candidates/save-decision-candidate/index.ts"
import { rejectDecisionCandidate } from "../../../repositories/decision-candidates/reject-decision-candidate/index.ts"
import { getDecisionModelConfiguration } from "../../../repositories/decision-model-configurations/get-decision-model-configuration/index.ts"
import { getDecisionModelPromotion } from "../../../repositories/decision-model-promotions/get-decision-model-promotion/index.ts"
import { saveDecisionModelPromotion } from "../../../repositories/decision-model-promotions/save-decision-model-promotion/index.ts"
import { createOrGetDecisionTrainingJob } from "../../../repositories/decision-training-jobs/create-or-get-decision-training-job/index.ts"
import { getDecisionTrainingJob } from "../../../repositories/decision-training-jobs/get-decision-training-job/index.ts"
import { sumDecisionTrainingUsage } from "../../../repositories/decision-training-jobs/sum-decision-training-usage/index.ts"
import { updateDecisionTrainingJob } from "../../../repositories/decision-training-jobs/update-decision-training-job/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { DecisionModelError } from "../errors.ts"
import type { DecisionModelStore, DecisionTrainingJobRecord } from "../types.ts"

const activeStates = ["QUEUED", "SUBMITTED", "RUNNING"] as const

function decimalUnits(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".")
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"))
}

function decimalString(value: bigint): string {
  const whole = value / 1_000_000_000n
  const fraction = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function jobRecord(
  job: Awaited<ReturnType<typeof getDecisionTrainingJob>> extends infer Result
    ? NonNullable<Result>
    : never,
): DecisionTrainingJobRecord {
  return {
    id: job.id,
    repositoryId: job.repositoryId,
    requestedByMembershipId: job.requestedByMembershipId,
    idempotencyKey: job.idempotencyKey,
    runtimeJobId: job.runtimeJobId,
    runtimeTasksetId: job.runtimeTasksetId,
    configurationGeneration: job.configurationGeneration,
    state: job.state,
    backend: job.backend,
    maxUpdates: job.maxUpdates,
    maxSeconds: job.maxSeconds,
    budgetCredits: job.budgetCredits.toString(),
    consentGrantId: job.consentGrantId,
    exportDigest: job.exportDigest,
    repeatableReviewSnapshotDigest: job.repeatableReviewSnapshotDigest,
    questionDigest: job.questionDigest,
    buildSetDigest: job.buildSetDigest,
    tasksetDigest: job.tasksetDigest,
    candidateRuntimeId: job.candidateRuntimeId,
    createdAt: job.createdAt,
  }
}

export function createDecisionModelStore(database: PrismaClient): DecisionModelStore {
  return {
    async getConfiguration(repositoryId) {
      const configuration = await getDecisionModelConfiguration(database, repositoryId)
      return configuration
        ? {
            enabled: configuration.enabled,
            generation: configuration.generation,
            backend: configuration.backend,
            maxUpdates: configuration.maxUpdates,
            maxSeconds: configuration.maxSeconds,
            monthlyBudgetCredits: configuration.monthlyBudgetCredits.toString(),
          }
        : null
    },
    getMonthlyUsageCredits: (repositoryId, since) =>
      sumDecisionTrainingUsage(database, repositoryId, since),
    async createOrGetJob(input) {
      return database.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
            SELECT id
            FROM decision_model_configurations
            WHERE repository_id = ${input.repositoryId}::uuid
            FOR UPDATE
          `
          const configuration = await getDecisionModelConfiguration(transaction, input.repositoryId)
          if (
            !configuration?.enabled ||
            configuration.generation !== input.configurationGeneration
          ) {
            throw new DecisionModelError(
              409,
              "configuration_stale",
              "The repository decision-model settings changed.",
            )
          }
          const existing = await getDecisionTrainingJobByIdempotencyKey(
            transaction,
            input.repositoryId,
            input.idempotencyKey,
          )
          if (existing) return { created: false, job: jobRecord(existing) }
          const since = new Date()
          since.setUTCDate(1)
          since.setUTCHours(0, 0, 0, 0)
          const [active, used] = await Promise.all([
            transaction.decisionTrainingJob.aggregate({
              where: {
                repositoryId: input.repositoryId,
                createdAt: { gte: since },
                state: { in: [...activeStates] },
              },
              _sum: { budgetCredits: true },
            }),
            transaction.decisionTrainingJob.aggregate({
              where: {
                repositoryId: input.repositoryId,
                createdAt: { gte: since },
                usageUnit: "credits",
                state: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
              },
              _sum: { usageQuantity: true },
            }),
          ])
          const remaining =
            decimalUnits(configuration.monthlyBudgetCredits.toString()) -
            decimalUnits(active._sum.budgetCredits?.toString() ?? "0") -
            decimalUnits(used._sum.usageQuantity?.toString() ?? "0")
          if (remaining <= 0) {
            throw new DecisionModelError(
              409,
              "budget_exceeded",
              "The repository decision-model budget has been reached.",
            )
          }
          const result = await createOrGetDecisionTrainingJob(transaction, {
            repositoryId: input.repositoryId,
            requestedByMembershipId: input.requestedByMembershipId,
            idempotencyKey: input.idempotencyKey,
            configurationGeneration: input.configurationGeneration,
            backend: input.settings.backend,
            maxUpdates: input.settings.maxUpdates,
            maxSeconds: input.settings.maxSeconds,
            budgetCredits: decimalString(remaining),
            consentGrantId: input.taskset.consentGrantId,
            exportDigest: input.taskset.exportDigest,
            repeatableReviewSnapshotDigest: input.taskset.repeatableReviewSnapshotDigest,
            questionDigest: input.taskset.questionDigest,
            buildSetDigest: input.taskset.buildSetDigest,
            tasksetDigest: input.taskset.tasksetDigest,
          })
          if (result.created) {
            await createSecurityAudit(transaction, {
              id: randomUUID(),
              type: "decision_training",
              actorMembershipId: input.requestedByMembershipId,
              outcome: "requested",
              repositoryId: input.repositoryId,
              jobId: result.job.id,
            })
          }
          return { created: result.created, job: jobRecord(result.job) }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      )
    },
    async getJob(repositoryId, jobId) {
      const job = await getDecisionTrainingJob(database, repositoryId, jobId)
      return job ? jobRecord(job) : null
    },
    async markJobSubmitted(input) {
      const result = await updateDecisionTrainingJob(database, {
        id: input.jobId,
        runtimeJobId: input.runtimeJobId,
        runtimeTasksetId: input.runtimeTasksetId,
        expectedStates: ["QUEUED"],
      })
      return jobRecord(result.job)
    },
    async updateJobState(input) {
      return database.$transaction(async (transaction) => {
        const result = await updateDecisionTrainingJob(transaction, {
          id: input.jobId,
          state: input.state,
          expectedStates: [...activeStates],
          candidateRuntimeId: input.candidateRuntimeId,
          failureCode: input.failureCode,
          usage: input.usage,
        })
        if (result.changed && input.audit) {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "decision_training",
            actorMembershipId: input.audit.actorMembershipId,
            outcome: input.audit.outcome,
            repositoryId: input.audit.repositoryId,
            jobId: input.jobId,
            ...(input.audit.reason ? { reason: input.audit.reason } : {}),
          })
        }
        return jobRecord(result.job)
      })
    },
    async completeJobWithCandidate(input) {
      return database.$transaction(async (transaction) => {
        const result = await updateDecisionTrainingJob(transaction, {
          id: input.trainingJobId,
          state: "SUCCEEDED",
          expectedStates: ["SUBMITTED", "RUNNING"],
          candidateRuntimeId: input.runtimeCandidateId,
          usage: input.jobUsage,
        })
        if (!result.changed) return { candidate: null, job: jobRecord(result.job) }
        const candidate = await saveDecisionCandidate(transaction, {
          ...input,
          learningMetrics: input.learningMetrics,
        })
        if (input.actorMembershipId) {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "decision_training",
            actorMembershipId: input.actorMembershipId,
            outcome: "succeeded",
            repositoryId: input.repositoryId,
            jobId: input.trainingJobId,
          })
        }
        return {
          candidate: {
            id: candidate.id,
            repositoryId: candidate.repositoryId,
            runtimeCandidateId: candidate.runtimeCandidateId,
            tasksetDigest: candidate.tasksetDigest,
            rejectedAt: candidate.rejectedAt,
          },
          job: jobRecord(result.job),
        }
      })
    },
    async getCandidate(repositoryId, candidateId) {
      const candidate = await getDecisionCandidate(database, repositoryId, candidateId)
      return candidate
        ? {
            id: candidate.id,
            repositoryId: candidate.repositoryId,
            runtimeCandidateId: candidate.runtimeCandidateId,
            tasksetDigest: candidate.tasksetDigest,
            rejectedAt: candidate.rejectedAt,
          }
        : null
    },
    async rejectCandidate(input) {
      return database.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT id
          FROM decision_candidates
          WHERE id = ${input.candidateId}::uuid
            AND repository_id = ${input.repositoryId}::uuid
          FOR UPDATE
        `
        const result = await rejectDecisionCandidate(transaction, {
          ...input,
          rejectedAt: new Date(),
        })
        if (result.status === "promoted") {
          throw new DecisionModelError(
            409,
            "candidate_already_promoted",
            "A promoted decision candidate cannot be rejected.",
          )
        }
        if (result.status === "not-found") {
          throw new DecisionModelError(404, "candidate_not_found", "Decision candidate not found.")
        }
        if (result.status === "rejected") {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "decision_candidate_rejection",
            actorMembershipId: input.rejectedByMembershipId,
            repositoryId: input.repositoryId,
            candidateId: input.candidateId,
          })
        }
        return {
          id: result.candidate.id,
          repositoryId: result.candidate.repositoryId,
          runtimeCandidateId: result.candidate.runtimeCandidateId,
          tasksetDigest: result.candidate.tasksetDigest,
          rejectedAt: result.candidate.rejectedAt,
        }
      })
    },
    async getPromotion(repositoryId) {
      const promotion = await getDecisionModelPromotion(database, repositoryId)
      return promotion
        ? {
            candidateId: promotion.candidateId,
            runtimeCandidateId: promotion.candidate.runtimeCandidateId,
            previousCandidateId: promotion.previousCandidateId,
            previousRuntimeCandidateId: promotion.previousCandidate?.runtimeCandidateId ?? null,
            runtimeGeneration: Number(promotion.runtimeGeneration),
          }
        : null
    },
    async savePromotion(input) {
      return database.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT id
          FROM decision_candidates
          WHERE id = ${input.candidateId}::uuid
            AND repository_id = ${input.repositoryId}::uuid
          FOR UPDATE
        `
        const candidate = await transaction.decisionCandidate.findFirst({
          where: { id: input.candidateId, repositoryId: input.repositoryId },
          select: { rejectedAt: true },
        })
        if (!candidate) {
          throw new DecisionModelError(404, "candidate_not_found", "Decision candidate not found.")
        }
        if (candidate.rejectedAt) {
          throw new DecisionModelError(
            409,
            "candidate_rejected",
            "A rejected decision candidate cannot be promoted.",
          )
        }
        const promotion = await saveDecisionModelPromotion(transaction, {
          ...input,
          runtimeGeneration: BigInt(input.runtimeGeneration),
        })
        await createSecurityAudit(transaction, {
          id: randomUUID(),
          type: "decision_promotion",
          actorMembershipId: input.promotedByMembershipId,
          operation: input.operation === "PROMOTE" ? "promote" : "rollback",
          outcome: "succeeded",
          repositoryId: input.repositoryId,
          candidateId: input.candidateId,
          generation: input.runtimeGeneration,
        })
        return {
          candidateId: promotion.candidateId,
          runtimeCandidateId: promotion.candidate.runtimeCandidateId,
          previousCandidateId: promotion.previousCandidateId,
          previousRuntimeCandidateId: promotion.previousCandidate?.runtimeCandidateId ?? null,
          runtimeGeneration: Number(promotion.runtimeGeneration),
        }
      })
    },
    async saveBuildEvaluation(input) {
      const summary: Prisma.InputJsonObject = {
        findings: input.summary.findings.map((finding) => ({
          learning: {
            id: finding.learning.id,
            text: finding.learning.text,
          },
          route: finding.route,
          views: finding.views.map((view) => ({
            viewport: view.viewport,
            theme: view.theme,
          })),
          followsProbability: finding.followsProbability,
          breaksProbability: finding.breaksProbability,
        })),
      }
      return saveDecisionBuildEvaluation(database, {
        ...input,
        promotionGeneration: BigInt(input.promotionGeneration),
        summary,
      })
    },
  }
}

function getDecisionTrainingJobByIdempotencyKey(
  database: Prisma.TransactionClient,
  repositoryId: string,
  idempotencyKey: string,
) {
  return database.decisionTrainingJob.findUnique({
    where: { repositoryId_idempotencyKey: { repositoryId, idempotencyKey } },
  })
}
