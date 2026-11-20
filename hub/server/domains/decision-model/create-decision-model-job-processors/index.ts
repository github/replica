import type { Logger } from "pino"

import { createJobProcessor } from "../../../integrations/bullmq/create-job-processor/index.ts"
import { createJobQueue } from "../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueRecoverableJob } from "../../../integrations/bullmq/enqueue-recoverable-job/index.ts"
import { listActiveDecisionTrainingJobs } from "../../../repositories/decision-training-jobs/list-active-decision-training-jobs/index.ts"
import { DecisionRuntimeError } from "../../../integrations/decision-runtime/create-decision-runtime-client/errors.ts"
import { DecisionModelError } from "../errors.ts"
import { decisionTrainingJob } from "../jobs/decision-training.ts"
import { recoverDecisionTrainingJobs } from "../jobs/recover-decision-training.ts"
import { reconcileRuntimeDeletionsJob } from "../jobs/reconcile-runtime-deletions.ts"
import { processDecisionTrainingJob } from "../process-decision-training-job/index.ts"
import { reconcileDecisionRuntimeDeletion } from "../reconcile-decision-runtime-deletion/index.ts"
import { processDecisionRuntimeDeletion } from "../process-decision-runtime-deletion/index.ts"
import type { DecisionModelDependencies } from "../types.ts"
import { resolveDecisionRuntime } from "../resolve-decision-runtime/index.ts"

class DecisionTrainingPendingError extends Error {}

export function createDecisionModelJobProcessors(input: {
  databaseUrl: string
  dependencies: DecisionModelDependencies
  database: Parameters<typeof listActiveDecisionTrainingJobs>[0]
  logger: Logger
}) {
  const run = createJobProcessor(
    decisionTrainingJob,
    async (job) => {
      try {
        const result = await processDecisionTrainingJob(job, input.dependencies)
        if (!result.terminal) {
          throw new DecisionTrainingPendingError("Decision training is still running.")
        }
      } catch (error) {
        if (
          error instanceof DecisionTrainingPendingError ||
          (error instanceof DecisionRuntimeError &&
            ["rate_limited", "timeout", "unavailable"].includes(error.code))
        ) {
          throw error
        }
        const record = await input.dependencies.store.getJob(job.repositoryId, job.jobId)
        if (!record || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(record.state)) return
        if (
          ((record.state === "SUBMITTING" || record.state === "CANCEL_REQUESTED") &&
            ((error instanceof DecisionModelError && error.code === "deletion_revoked") ||
              (error instanceof DecisionRuntimeError && error.code === "deletion_revoked"))) ||
          (record.state === "CANCEL_REQUESTED" &&
            error instanceof DecisionModelError &&
            ["consent_required", "taskset_drift"].includes(error.code))
        ) {
          await input.dependencies.store.updateJobState({
            jobId: record.id,
            state: "CANCELLED",
            failureCode: error.code,
            usage: [],
            ...(record.requestedByMembershipId
              ? {
                  audit: {
                    actorMembershipId: record.requestedByMembershipId,
                    outcome: "cancelled" as const,
                    reason: error.code,
                    repositoryId: record.repositoryId,
                  },
                }
              : {}),
          })
          return
        }
        if (
          !record.runtimeJobId &&
          (record.state === "SUBMITTING" || record.state === "CANCEL_REQUESTED")
        ) {
          throw new DecisionTrainingPendingError(
            "Decision training submission still needs reconciliation.",
          )
        }
        let usage
        if (record.runtimeJobId) {
          const runtime = resolveDecisionRuntime(input.dependencies, job.repositoryId)
          try {
            usage = (
              await runtime.cancelTrainingJob({
                id: record.runtimeJobId,
                idempotencyKey: `cancel:${record.id}`,
              })
            ).usage
          } catch (cancelError) {
            if (cancelError instanceof DecisionRuntimeError && cancelError.code === "conflict") {
              usage = (await runtime.getTrainingJob(record.runtimeJobId)).usage
            } else {
              throw cancelError
            }
          }
        }
        const failureCode =
          error instanceof DecisionRuntimeError || error instanceof DecisionModelError
            ? error.code
            : error instanceof Error
              ? error.name.slice(0, 100)
              : "decision_training_failed"
        await input.dependencies.store.updateJobState({
          jobId: record.id,
          state: "FAILED",
          failureCode,
          usage,
          ...(record.requestedByMembershipId
            ? {
                audit: {
                  actorMembershipId: record.requestedByMembershipId,
                  outcome: "failed" as const,
                  reason: failureCode,
                  repositoryId: record.repositoryId,
                },
              }
            : {}),
        })
      }
    },
    (error) =>
      error instanceof DecisionTrainingPendingError ||
      (error instanceof DecisionRuntimeError &&
        ["rate_limited", "timeout", "unavailable"].includes(error.code)),
  )
  const recover = createJobProcessor(recoverDecisionTrainingJobs, async () => {
    const queue = createJobQueue({
      name: "on-demand",
      databaseUrl: input.databaseUrl,
      logger: input.logger,
    })
    try {
      for (const job of await listActiveDecisionTrainingJobs(input.database)) {
        await enqueueRecoverableJob(
          queue,
          decisionTrainingJob,
          { repositoryId: job.repositoryId, jobId: job.id },
          `decision-training-${job.id}`,
        )
      }
    } finally {
      await queue.close()
    }
  })
  const reconcileDeletions = createJobProcessor(reconcileRuntimeDeletionsJob, async () => {
    for (const withdrawal of await (input.dependencies.listTrainingWithdrawals?.() ??
      Promise.resolve([]))) {
      try {
        await processDecisionRuntimeDeletion(withdrawal, input.dependencies)
      } catch (error) {
        input.logger.warn(
          {
            errorType: error instanceof Error ? error.name : "UnknownError",
            repositoryId: withdrawal.repositoryId,
            idempotencyKey: withdrawal.idempotencyKey,
          },
          "Decision runtime withdrawal reconciliation failed",
        )
      }
    }
    for (const deletion of await (input.dependencies.store.listPendingDeletions?.() ??
      Promise.resolve([]))) {
      try {
        await reconcileDecisionRuntimeDeletion(deletion.id, input.dependencies)
      } catch (error) {
        input.logger.warn(
          {
            errorType: error instanceof Error ? error.name : "UnknownError",
            deletionId: deletion.id,
          },
          "Decision runtime deletion receipt reconciliation failed",
        )
      }
    }
  })
  return { run, recover, reconcileDeletions }
}
