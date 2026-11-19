import type { Logger } from "pino"
import { z } from "zod"

import { cancelDecisionTraining } from "../../../../domains/decision-model/cancel-decision-training/index.ts"
import { createCurrentAdministratorDecisionAuthorization } from "../../../../domains/decision-model/create-current-administrator-decision-authorization/index.ts"
import { createDecisionModelStore } from "../../../../domains/decision-model/create-decision-model-store/index.ts"
import { evaluateBuildWithDecisionModel } from "../../../../domains/decision-model/evaluate-build-with-decision-model/index.ts"
import { DecisionModelError } from "../../../../domains/decision-model/errors.ts"
import { decisionTrainingJob } from "../../../../domains/decision-model/jobs/decision-training.ts"
import { prepareDecisionTaskset } from "../../../../domains/decision-model/prepare-decision-taskset/index.ts"
import { preflightDecisionTaskset } from "../../../../domains/decision-model/prepare-decision-taskset/index.ts"
import type { DecisionTasksetPreparationSource } from "../../../../domains/decision-model/prepare-decision-taskset/index.ts"
import { promoteDecisionCandidate } from "../../../../domains/decision-model/promote-decision-candidate/index.ts"
import { requestDecisionTraining } from "../../../../domains/decision-model/request-decision-training/index.ts"
import { rejectDecisionCandidate } from "../../../../domains/decision-model/reject-decision-candidate/index.ts"
import { rollbackDecisionCandidate } from "../../../../domains/decision-model/rollback-decision-candidate/index.ts"
import type { PreparedBuildEvaluation } from "../../../../domains/decision-model/types.ts"
import { createDecisionRuntimeClient } from "../../../../integrations/decision-runtime/create-decision-runtime-client/index.ts"
import type { DecisionRuntimeCredentialProvider } from "../../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"
import { createJobQueue } from "../../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueJob } from "../../../../integrations/bullmq/enqueue-job/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import {
  DecisionModelControlBusyError,
  withDecisionModelControlLock,
} from "../../../../integrations/postgres/with-decision-model-control-lock/index.ts"
import { getDecisionModelOverview } from "../../../../repositories/decision-model-configurations/get-decision-model-overview/index.ts"
import { saveDecisionModelConfiguration } from "../../../../repositories/decision-model-configurations/save-decision-model-configuration/index.ts"
import { isEffectiveAdministrator } from "../../../../repositories/memberships/is-effective-administrator/index.ts"
import { findActiveRepository } from "../../../../repositories/prototype-index/find-active-repository/index.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import type { DecisionModelRouteDependencies } from "../types.ts"

const learningMetricsSchema = z.array(
  z
    .object({
      learningId: z.string(),
      baselineBalancedAccuracy: z.number().nullable(),
      candidateBalancedAccuracy: z.number().nullable(),
      delta: z.number().nullable(),
      direction: z.enum(["gain", "regression", "unchanged", "unknown"]),
    })
    .strict(),
)
const evaluationSummarySchema = z
  .object({
    findings: z.array(
      z
        .object({
          learning: z.object({ id: z.string(), text: z.string().nullable() }).strict(),
          route: z.string(),
          views: z.array(
            z
              .object({
                viewport: z.string(),
                theme: z.string(),
              })
              .strict(),
          ),
          followsProbability: z.number().min(0).max(1),
          breaksProbability: z.number().min(0).max(1),
        })
        .strict(),
    ),
  })
  .strict()

function presentJobState(
  state: "QUEUED" | "SUBMITTED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED",
) {
  switch (state) {
    case "QUEUED":
      return "queued" as const
    case "SUBMITTED":
      return "submitted" as const
    case "RUNNING":
      return "running" as const
    case "SUCCEEDED":
      return "succeeded" as const
    case "FAILED":
      return "failed" as const
    case "CANCELLED":
      return "cancelled" as const
  }
}

function presentPromotionOperation(operation: "PROMOTE" | "ROLLBACK") {
  return operation === "PROMOTE" ? ("promote" as const) : ("rollback" as const)
}

interface CreateDecisionModelRouteDependenciesOptions {
  applicationOrigin: string
  baseUrl: string
  credentialProvider: DecisionRuntimeCredentialProvider
  currentSession: CurrentSessionDependencies
  databaseUrl: string
  logger: Logger
  tasksetSource: DecisionTasksetPreparationSource
  prepareBuildEvaluation(input: {
    repositoryId: string
    buildId: string
  }): Promise<PreparedBuildEvaluation>
}

export function createDecisionModelRouteDependencies(
  options: CreateDecisionModelRouteDependenciesOptions,
): DecisionModelRouteDependencies {
  const runtime = createDecisionRuntimeClient({
    baseUrl: options.baseUrl,
    credentialProvider: options.credentialProvider,
  })
  const store = createDecisionModelStore(prisma)
  const authorization = createCurrentAdministratorDecisionAuthorization({
    isEffectiveAdministrator: (membershipId) => isEffectiveAdministrator(prisma, membershipId),
    isRepositoryVisible: async (repositoryId) =>
      Boolean(await findActiveRepository(prisma, repositoryId, null)),
  })
  const dependencies = {
    authorization,
    now: () => new Date(),
    prepareTaskset: (input: { repositoryId: string; actorMembershipId: string }) =>
      prepareDecisionTaskset(input, options.tasksetSource),
    preflightTaskset: (input: { repositoryId: string; actorMembershipId: string }) =>
      preflightDecisionTaskset(input, options.tasksetSource),
    prepareBuildEvaluation: (input: { repositoryId: string; buildId: string }) =>
      options.prepareBuildEvaluation(input),
    runtime,
    store,
    withControlLock: async <Result>(operation: (signal: AbortSignal) => Promise<Result>) => {
      try {
        return await withDecisionModelControlLock({
          databaseUrl: options.databaseUrl,
          run: operation,
        })
      } catch (error) {
        if (error instanceof DecisionModelControlBusyError) {
          throw new DecisionModelError(
            409,
            "control_busy",
            "Another decision-model control operation is still running.",
            { cause: error },
          )
        }
        throw error
      }
    },
  }
  return {
    applicationOrigin: options.applicationOrigin,
    currentSession: options.currentSession,
    async getOverview(input) {
      await authorization.requireRepositoryAdministrator({
        membershipId: input.actorMembershipId,
        repositoryId: input.repositoryId,
      })
      const [overview, preflight] = await Promise.all([
        getDecisionModelOverview(prisma, input.repositoryId),
        dependencies.preflightTaskset(input),
      ])
      const currentPromotion = overview.promotion
      return {
        preflight,
        configuration: overview.configuration
          ? {
              enabled: overview.configuration.enabled,
              generation: overview.configuration.generation,
              backend: overview.configuration.backend,
              maxUpdates: overview.configuration.maxUpdates,
              maxSeconds: overview.configuration.maxSeconds,
              monthlyBudgetCredits: overview.configuration.monthlyBudgetCredits.toString(),
            }
          : null,
        jobs: overview.jobs.map((job) => ({
          id: job.id,
          state: presentJobState(job.state),
          tasksetDigest: job.tasksetDigest,
          runtimeJobId: job.runtimeJobId,
          candidateRuntimeId: job.candidateRuntimeId,
          failureCode: job.failureCode,
          createdAt: job.createdAt.toISOString(),
          finishedAt: job.finishedAt?.toISOString() ?? null,
        })),
        candidates: overview.candidates.map((candidate) => ({
          id: candidate.id,
          runtimeCandidateId: candidate.runtimeCandidateId,
          tasksetDigest: candidate.tasksetDigest,
          productionEligible: candidate.productionEligible,
          baselineMeanReward: candidate.baselineMeanReward?.toString() ?? null,
          candidateMeanReward: candidate.candidateMeanReward?.toString() ?? null,
          meanRewardDelta: candidate.meanRewardDelta?.toString() ?? null,
          baselineCalibrationError: candidate.baselineCalibrationError?.toString() ?? null,
          candidateCalibrationError: candidate.candidateCalibrationError?.toString() ?? null,
          calibrationErrorDelta: candidate.calibrationErrorDelta?.toString() ?? null,
          learningMetrics: learningMetricsSchema.parse(candidate.learningMetrics),
          durationSeconds: candidate.durationSeconds?.toNumber() ?? null,
          usage:
            candidate.usageQuantity && candidate.usageUnit
              ? {
                  quantity: candidate.usageQuantity.toString(),
                  unit: candidate.usageUnit,
                  cost:
                    candidate.costAmount && candidate.costCurrency
                      ? {
                          amount: candidate.costAmount.toString(),
                          currency: candidate.costCurrency,
                        }
                      : null,
                }
              : null,
          rejection: candidate.rejectedAt
            ? {
                rejectedAt: candidate.rejectedAt.toISOString(),
                reason: candidate.rejectedReason,
                membershipId: candidate.rejectedByMembershipId,
              }
            : null,
          createdAt: candidate.createdAt.toISOString(),
        })),
        promotion: currentPromotion
          ? {
              candidateId: currentPromotion.candidateId,
              runtimeCandidateId: currentPromotion.candidate.runtimeCandidateId,
              generation: Number(currentPromotion.runtimeGeneration),
              operation: presentPromotionOperation(currentPromotion.operation),
              rollbackAvailable: Boolean(
                currentPromotion.previousCandidate &&
                !currentPromotion.previousCandidate.rejectedAt,
              ),
            }
          : null,
        promotionHistory: overview.promotions.map((promotion) => ({
          candidateId: promotion.candidateId,
          runtimeCandidateId: promotion.candidate.runtimeCandidateId,
          previousCandidateId: promotion.previousCandidateId,
          previousRuntimeCandidateId: promotion.previousCandidate?.runtimeCandidateId ?? null,
          generation: Number(promotion.runtimeGeneration),
          operation: presentPromotionOperation(promotion.operation),
          membershipId: promotion.promotedByMembershipId,
          createdAt: promotion.createdAt.toISOString(),
        })),
        evaluations: overview.evaluations.map((evaluation) => ({
          id: evaluation.id,
          build: {
            id: evaluation.buildId,
            number: evaluation.build.number,
            prototypeId: evaluation.build.prototypeId,
          },
          model: {
            id: evaluation.candidateId,
            runtimeCandidateId: evaluation.candidate.runtimeCandidateId,
            generation: Number(evaluation.promotionGeneration),
          },
          findings: evaluationSummarySchema.parse(evaluation.summary).findings,
          createdAt: evaluation.createdAt.toISOString(),
        })),
      }
    },
    async saveSettings(input) {
      await authorization.requireRepositoryAdministrator({
        membershipId: input.actorMembershipId,
        repositoryId: input.repositoryId,
      })
      const saved = await saveDecisionModelConfiguration(prisma, {
        repositoryId: input.repositoryId,
        ...input.settings,
      })
      return {
        enabled: saved.enabled,
        generation: saved.generation,
        backend: saved.backend,
        maxUpdates: saved.maxUpdates,
        maxSeconds: saved.maxSeconds,
        monthlyBudgetCredits: saved.monthlyBudgetCredits.toString(),
      }
    },
    async requestTraining(input) {
      const result = await requestDecisionTraining(input, dependencies)
      if (result.created) {
        const queue = createJobQueue({
          name: "on-demand",
          databaseUrl: options.databaseUrl,
          logger: options.logger,
        })
        try {
          await enqueueJob(
            queue,
            decisionTrainingJob,
            { repositoryId: input.repositoryId, jobId: result.job.id },
            { jobId: `decision-training-${result.job.id}` },
          )
        } finally {
          await queue.close()
        }
      }
      return {
        created: result.created,
        jobId: result.job.id,
        state: result.job.state.toLowerCase(),
      }
    },
    async getTrainingJob(input) {
      await authorization.requireRepositoryAdministrator({
        membershipId: input.actorMembershipId,
        repositoryId: input.repositoryId,
      })
      const job = await store.getJob(input.repositoryId, input.jobId)
      if (!job) throw new DecisionModelError(404, "job_not_found", "Training job not found.")
      return { ...job, state: job.state.toLowerCase() }
    },
    cancelTraining: (input) => cancelDecisionTraining(input, dependencies),
    rejectCandidate: (input) => rejectDecisionCandidate(input, dependencies),
    promote: (input) => promoteDecisionCandidate(input, dependencies),
    rollback: (input) => rollbackDecisionCandidate(input, dependencies),
    async evaluateBuild(input) {
      await authorization.requireRepositoryAdministrator({
        membershipId: input.actorMembershipId,
        repositoryId: input.repositoryId,
      })
      return evaluateBuildWithDecisionModel(input, dependencies)
    },
  }
}
