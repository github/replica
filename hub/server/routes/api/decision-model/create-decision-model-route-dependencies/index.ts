import type { Logger } from "pino"
import { z } from "zod"

import { cancelDecisionTraining } from "../../../../domains/decision-model/cancel-decision-training/index.ts"
import { createDecisionModelStore } from "../../../../domains/decision-model/create-decision-model-store/index.ts"
import { evaluateBuildWithDecisionModel } from "../../../../domains/decision-model/evaluate-build-with-decision-model/index.ts"
import { DecisionModelError } from "../../../../domains/decision-model/errors.ts"
import { decisionTrainingJob } from "../../../../domains/decision-model/jobs/decision-training.ts"
import { prepareDecisionTaskset } from "../../../../domains/decision-model/prepare-decision-taskset/index.ts"
import { preflightDecisionTaskset } from "../../../../domains/decision-model/preflight-decision-taskset/index.ts"
import type { DecisionTasksetPreparationSource } from "../../../../domains/decision-model/prepare-decision-taskset/index.ts"
import { promoteDecisionCandidate } from "../../../../domains/decision-model/promote-decision-candidate/index.ts"
import { requestDecisionTraining } from "../../../../domains/decision-model/request-decision-training/index.ts"
import { rejectDecisionCandidate } from "../../../../domains/decision-model/reject-decision-candidate/index.ts"
import { processDecisionRuntimeDeletion } from "../../../../domains/decision-model/process-decision-runtime-deletion/index.ts"
import { rollbackDecisionCandidate } from "../../../../domains/decision-model/rollback-decision-candidate/index.ts"
import type {
  DecisionTrainingJobRecord,
  PreparedBuildEvaluation,
} from "../../../../domains/decision-model/types.ts"
import type { DecisionRuntimeClient } from "../../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"
import { createJobQueue } from "../../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueJob } from "../../../../integrations/bullmq/enqueue-job/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import {
  DecisionModelControlBusyError,
  withDecisionModelControlLock,
} from "../../../../integrations/postgres/with-decision-model-control-lock/index.ts"
import { getDecisionModelOverview } from "../../../../repositories/decision-model-configurations/get-decision-model-overview/index.ts"
import { saveDecisionModelConfiguration } from "../../../../repositories/decision-model-configurations/save-decision-model-configuration/index.ts"
import { lockRepositoryAdministratorAuthority } from "../../../../repositories/repository-access/lock-repository-administrator-authority/index.ts"
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
const usageRecordsSchema = z.array(
  z
    .object({
      connector: z.string(),
      kind: z.string(),
      quantity: z.number().nonnegative(),
      unit: z.string(),
      cost: z.number().nonnegative().nullable(),
      currency: z.string().nullable(),
      source: z.string(),
      metadata: z.record(z.string(), z.unknown()),
    })
    .strict(),
)
const evaluationSummarySchema = z
  .object({
    findings: z.array(
      z
        .object({
          learning: z.object({ id: z.string() }).strict(),
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
          explanation: z.string().min(1).max(500).optional(),
        })
        .strict(),
    ),
  })
  .strict()

function presentJobState(
  state:
    | "QUEUED"
    | "SUBMITTING"
    | "CANCEL_REQUESTED"
    | "SUBMITTED"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED",
) {
  switch (state) {
    case "QUEUED":
      return "queued" as const
    case "SUBMITTING":
      return "submitting" as const
    case "SUBMITTED":
      return "submitted" as const
    case "CANCEL_REQUESTED":
      return "cancel_requested" as const
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

function presentJob(job: DecisionTrainingJobRecord) {
  return {
    id: job.id,
    state: presentJobState(job.state),
    runtimeJobId: job.runtimeJobId,
    candidateRuntimeId: job.candidateRuntimeId,
    failureCode: job.failureCode ?? null,
    createdAt: job.createdAt.toISOString(),
  }
}

function presentPromotion(promotion: {
  candidateId: string
  runtimeCandidateId: string
  previousCandidateId: string | null
  previousRuntimeCandidateId: string | null
  runtimeGeneration: number
}) {
  return {
    candidateId: promotion.candidateId,
    runtimeCandidateId: promotion.runtimeCandidateId,
    previousCandidateId: promotion.previousCandidateId,
    previousRuntimeCandidateId: promotion.previousRuntimeCandidateId,
    generation: promotion.runtimeGeneration,
  }
}
interface CreateDecisionModelRouteDependenciesOptions {
  applicationOrigin: string
  runtimeForRepository(repositoryId: string): DecisionRuntimeClient
  currentSession: CurrentSessionDependencies
  databaseUrl: string
  logger: Logger
  tasksetSource: DecisionTasksetPreparationSource
  prepareBuildEvaluation(input: {
    repositoryId: string
    buildId: string
    actorMembershipId: string
  }): Promise<PreparedBuildEvaluation>
}

export function createDecisionModelRouteDependencies(
  options: CreateDecisionModelRouteDependenciesOptions,
): DecisionModelRouteDependencies {
  const store = createDecisionModelStore(prisma)
  const authorization = {
    requireRepositoryAdministrator: async (input: {
      membershipId: string
      repositoryId: string
    }) => {
      const authorized = await prisma.$transaction((transaction) =>
        lockRepositoryAdministratorAuthority(transaction, input),
      )
      if (!authorized) {
        throw new DecisionModelError(
          403,
          "access_denied",
          "Repository administrator access is required.",
        )
      }
    },
  }
  const dependencies = {
    authorization,
    now: () => new Date(),
    prepareTaskset: (input: { repositoryId: string; actorMembershipId: string }) =>
      prepareDecisionTaskset(input, options.tasksetSource),
    preflightTaskset: (input: { repositoryId: string; actorMembershipId: string }) =>
      preflightDecisionTaskset(input, options.tasksetSource),
    hasTrainingConsent: (input: {
      repositoryId: string
      actorMembershipId: string
      consentGrantId: string
    }) => options.tasksetSource.hasTrainingConsent(input),
    prepareBuildEvaluation: (input: {
      repositoryId: string
      buildId: string
      actorMembershipId: string
    }) => options.prepareBuildEvaluation(input),
    runtimeForRepository: (repositoryId: string) => options.runtimeForRepository(repositoryId),
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
    listTrainingWithdrawals: () => options.tasksetSource.listTrainingWithdrawals(),
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
      const evaluations = await Promise.all(
        overview.evaluations.map(async (evaluation) => {
          const summary = evaluationSummarySchema.parse(evaluation.summary)
          return {
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
            findings: await Promise.all(
              summary.findings.map(async (finding) => ({
                ...finding,
                learning: {
                  id: finding.learning.id,
                  text: await options.tasksetSource.getLearningText({
                    repositoryId: input.repositoryId,
                    learningId: finding.learning.id,
                  }),
                },
              })),
            ),
            createdAt: evaluation.createdAt.toISOString(),
          }
        }),
      )
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
          usage: usageRecordsSchema.parse(candidate.usageRecords),
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
        evaluations: overview.evaluations.map((evaluation) => {
          const summary = evaluationSummarySchema.safeParse(evaluation.summary)
          return {
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
            questionDigest: evaluation.questionDigest,
            screenshotSetDigest: evaluation.screenshotSetDigest,
            responseDigest: evaluation.responseDigest,
            findingsAvailable: summary.success,
            findings: summary.success
              ? summary.data.findings.map((finding) => ({
                  ...finding,
                  explanation:
                    finding.explanation ??
                    (finding.breaksProbability > finding.followsProbability
                      ? "Across the submitted captured views, the promoted decision model found the Build more likely to break the learning than follow it."
                      : "Across the submitted captured views, the promoted decision model found the Build at least as likely to follow the learning as break it."),
                }))
              : [],
            createdAt: evaluation.createdAt.toISOString(),
          }
        }),
        deletions: (overview.deletions ?? []).map((deletion) => ({
          id: deletion.id,
          state: deletion.state.toLowerCase() as "pending" | "completed" | "failed",
          selectors: {
            exportId: deletion.exportId,
            grantId: deletion.grantId,
            evidenceDigest: deletion.evidenceDigest,
            tasksetDigest: deletion.tasksetDigest,
          },
          pending: deletion.pendingCount,
          failures: deletion.failureCount,
          revokedAt: deletion.revokedAt?.toISOString() ?? null,
          completedAt: deletion.completedAt?.toISOString() ?? null,
          failureCode: deletion.failureCode,
        })),
      }
    },
    async saveSettings(input) {
      const saved = await prisma.$transaction(async (transaction) => {
        if (
          !(await lockRepositoryAdministratorAuthority(transaction, {
            membershipId: input.actorMembershipId,
            repositoryId: input.repositoryId,
          }))
        ) {
          throw new DecisionModelError(
            403,
            "access_denied",
            "Repository administrator access is required.",
          )
        }
        return saveDecisionModelConfiguration(transaction, {
          repositoryId: input.repositoryId,
          ...input.settings,
        })
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
        job: presentJob(result.job),
      }
    },
    async getTrainingJob(input) {
      await authorization.requireRepositoryAdministrator({
        membershipId: input.actorMembershipId,
        repositoryId: input.repositoryId,
      })
      const job = await store.getJob(input.repositoryId, input.jobId)
      if (!job) throw new DecisionModelError(404, "job_not_found", "Training job not found.")
      return presentJob(job)
    },
    cancelTraining: async (input) => presentJob(await cancelDecisionTraining(input, dependencies)),
    rejectCandidate: async (input) => {
      const candidate = await rejectDecisionCandidate(input, dependencies)
      if (!candidate.rejectedAt) {
        throw new Error("The rejected candidate has no rejection timestamp.")
      }
      return {
        candidateId: candidate.id,
        rejectedAt: candidate.rejectedAt.toISOString(),
      }
    },
    promote: async (input) => presentPromotion(await promoteDecisionCandidate(input, dependencies)),
    rollback: async (input) =>
      presentPromotion(await rollbackDecisionCandidate(input, dependencies)),
    async evaluateBuild(input) {
      await authorization.requireRepositoryAdministrator({
        membershipId: input.actorMembershipId,
        repositoryId: input.repositoryId,
      })
      return evaluateBuildWithDecisionModel(input, dependencies)
    },
    withdrawTrainingData: (input) => processDecisionRuntimeDeletion(input, dependencies),
  }
}
