import type { Prisma } from "../../../generated/prisma/client.ts"

import { getDecisionCandidate } from "../../../repositories/decision-candidates/get-decision-candidate/index.ts"
import { saveDecisionCandidate } from "../../../repositories/decision-candidates/save-decision-candidate/index.ts"
import { saveDecisionBuildEvaluation } from "../../../repositories/decision-build-evaluations/save-decision-build-evaluation/index.ts"
import { getDecisionModelConfiguration } from "../../../repositories/decision-model-configurations/get-decision-model-configuration/index.ts"
import { getDecisionModelPromotion } from "../../../repositories/decision-model-promotions/get-decision-model-promotion/index.ts"
import { saveDecisionModelPromotion } from "../../../repositories/decision-model-promotions/save-decision-model-promotion/index.ts"
import { createOrGetDecisionTrainingJob } from "../../../repositories/decision-training-jobs/create-or-get-decision-training-job/index.ts"
import { getDecisionTrainingJob } from "../../../repositories/decision-training-jobs/get-decision-training-job/index.ts"
import { sumDecisionTrainingUsage } from "../../../repositories/decision-training-jobs/sum-decision-training-usage/index.ts"
import { updateDecisionTrainingJob } from "../../../repositories/decision-training-jobs/update-decision-training-job/index.ts"
import type { DecisionModelStore, DecisionTrainingJobRecord } from "../types.ts"

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

export function createDecisionModelStore(
  database: Pick<
    Prisma.TransactionClient,
    | "decisionBuildEvaluation"
    | "decisionCandidate"
    | "decisionModelConfiguration"
    | "decisionModelPromotion"
    | "decisionTrainingJob"
  >,
): DecisionModelStore {
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
      const result = await createOrGetDecisionTrainingJob(database, {
        repositoryId: input.repositoryId,
        requestedByMembershipId: input.requestedByMembershipId,
        idempotencyKey: input.idempotencyKey,
        configurationGeneration: input.configurationGeneration,
        backend: input.settings.backend,
        maxUpdates: input.settings.maxUpdates,
        maxSeconds: input.settings.maxSeconds,
        budgetCredits: input.settings.monthlyBudgetCredits,
        consentGrantId: input.taskset.consentGrantId,
        exportDigest: input.taskset.exportDigest,
        repeatableReviewSnapshotDigest: input.taskset.repeatableReviewSnapshotDigest,
        questionDigest: input.taskset.questionDigest,
        buildSetDigest: input.taskset.buildSetDigest,
        tasksetDigest: input.taskset.tasksetDigest,
      })
      return { created: result.created, job: jobRecord(result.job) }
    },
    async getJob(repositoryId, jobId) {
      const job = await getDecisionTrainingJob(database, repositoryId, jobId)
      return job ? jobRecord(job) : null
    },
    async markJobSubmitted(input) {
      return jobRecord(
        await updateDecisionTrainingJob(database, {
          id: input.jobId,
          runtimeJobId: input.runtimeJobId,
          runtimeTasksetId: input.runtimeTasksetId,
        }),
      )
    },
    async updateJobState(input) {
      return jobRecord(
        await updateDecisionTrainingJob(database, {
          id: input.jobId,
          state: input.state,
          candidateRuntimeId: input.candidateRuntimeId,
          failureCode: input.failureCode,
          usage: input.usage,
        }),
      )
    },
    async saveCandidate(input) {
      const candidate = await saveDecisionCandidate(database, input)
      return {
        id: candidate.id,
        repositoryId: candidate.repositoryId,
        runtimeCandidateId: candidate.runtimeCandidateId,
        tasksetDigest: candidate.tasksetDigest,
      }
    },
    async getCandidate(repositoryId, candidateId) {
      const candidate = await getDecisionCandidate(database, repositoryId, candidateId)
      return candidate
        ? {
            id: candidate.id,
            repositoryId: candidate.repositoryId,
            runtimeCandidateId: candidate.runtimeCandidateId,
            tasksetDigest: candidate.tasksetDigest,
          }
        : null
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
      const promotion = await saveDecisionModelPromotion(database, {
        ...input,
        runtimeGeneration: BigInt(input.runtimeGeneration),
      })
      return {
        candidateId: promotion.candidateId,
        runtimeCandidateId: promotion.candidate.runtimeCandidateId,
        previousCandidateId: promotion.previousCandidateId,
        previousRuntimeCandidateId: promotion.previousCandidate?.runtimeCandidateId ?? null,
        runtimeGeneration: Number(promotion.runtimeGeneration),
      }
    },
    async saveBuildEvaluation(input) {
      return saveDecisionBuildEvaluation(database, {
        ...input,
        promotionGeneration: BigInt(input.promotionGeneration),
        summary: input.summary as Prisma.InputJsonValue,
      })
    },
  }
}
