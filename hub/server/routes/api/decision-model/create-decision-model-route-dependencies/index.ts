import type { Logger } from "pino"

import { cancelDecisionTraining } from "../../../../domains/decision-model/cancel-decision-training/index.ts"
import { createCurrentAdministratorDecisionAuthorization } from "../../../../domains/decision-model/create-current-administrator-decision-authorization/index.ts"
import { createDecisionModelStore } from "../../../../domains/decision-model/create-decision-model-store/index.ts"
import { evaluateBuildWithDecisionModel } from "../../../../domains/decision-model/evaluate-build-with-decision-model/index.ts"
import { DecisionModelError } from "../../../../domains/decision-model/errors.ts"
import { decisionTrainingJob } from "../../../../domains/decision-model/jobs/decision-training.ts"
import { prepareDecisionTaskset } from "../../../../domains/decision-model/prepare-decision-taskset/index.ts"
import type { DecisionTasksetPreparationSource } from "../../../../domains/decision-model/prepare-decision-taskset/index.ts"
import { promoteDecisionCandidate } from "../../../../domains/decision-model/promote-decision-candidate/index.ts"
import { requestDecisionTraining } from "../../../../domains/decision-model/request-decision-training/index.ts"
import { rollbackDecisionCandidate } from "../../../../domains/decision-model/rollback-decision-candidate/index.ts"
import type { PreparedBuildEvaluation } from "../../../../domains/decision-model/types.ts"
import { createDecisionRuntimeClient } from "../../../../integrations/decision-runtime/create-decision-runtime-client/index.ts"
import type { DecisionRuntimeCredentialProvider } from "../../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"
import { createJobQueue } from "../../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueJob } from "../../../../integrations/bullmq/enqueue-job/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { getDecisionModelOverview } from "../../../../repositories/decision-model-configurations/get-decision-model-overview/index.ts"
import { saveDecisionModelConfiguration } from "../../../../repositories/decision-model-configurations/save-decision-model-configuration/index.ts"
import { isEffectiveAdministrator } from "../../../../repositories/memberships/is-effective-administrator/index.ts"
import { findActiveRepository } from "../../../../repositories/prototype-index/find-active-repository/index.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import type { DecisionModelRouteDependencies } from "../types.ts"

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
    prepareBuildEvaluation: (input: { repositoryId: string; buildId: string }) =>
      options.prepareBuildEvaluation(input),
    runtime,
    store,
  }
  return {
    applicationOrigin: options.applicationOrigin,
    currentSession: options.currentSession,
    async getOverview(input) {
      await authorization.requireRepositoryAdministrator({
        membershipId: input.actorMembershipId,
        repositoryId: input.repositoryId,
      })
      const overview = await getDecisionModelOverview(prisma, input.repositoryId)
      return {
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
          state: job.state.toLowerCase(),
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
          meanRewardDelta: candidate.meanRewardDelta?.toString() ?? null,
          calibrationErrorDelta: candidate.calibrationErrorDelta?.toString() ?? null,
          createdAt: candidate.createdAt.toISOString(),
        })),
        promotion: overview.promotion
          ? {
              candidateId: overview.promotion.candidateId,
              runtimeCandidateId: overview.promotion.candidate.runtimeCandidateId,
              generation: Number(overview.promotion.runtimeGeneration),
              operation: overview.promotion.operation.toLowerCase(),
            }
          : null,
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
