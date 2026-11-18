import { DecisionRuntimeError } from "../../../integrations/decision-runtime/create-decision-runtime-client/errors.ts"
import { withTelemetrySpan } from "../../../integrations/opentelemetry/with-telemetry-span/index.ts"
import { DecisionModelError } from "../errors.ts"
import type { DecisionModelDependencies, DecisionTrainingJobRecord } from "../types.ts"

export async function processDecisionTrainingJob(
  input: { repositoryId: string; jobId: string },
  dependencies: DecisionModelDependencies,
): Promise<{ terminal: boolean; job: DecisionTrainingJobRecord }> {
  return withTelemetrySpan(
    "decision.training.process",
    { "replica.repository.id": input.repositoryId },
    async () => {
      const job = await dependencies.store.getJob(input.repositoryId, input.jobId)
      if (!job) throw new DecisionModelError(404, "job_not_found", "Training job not found.")
      if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state)) {
        return { terminal: true, job }
      }
      if (dependencies.now().getTime() - job.createdAt.getTime() > (job.maxSeconds + 300) * 1_000) {
        return {
          terminal: true,
          job: await dependencies.store.updateJobState({
            jobId: job.id,
            state: "FAILED",
            failureCode: "polling_deadline_exceeded",
            ...(job.requestedByMembershipId
              ? {
                  audit: {
                    actorMembershipId: job.requestedByMembershipId,
                    outcome: "failed" as const,
                    reason: "polling_deadline_exceeded",
                    repositoryId: job.repositoryId,
                  },
                }
              : {}),
          }),
        }
      }
      const configuration = await dependencies.store.getConfiguration(input.repositoryId)
      if (!configuration || configuration.generation !== job.configurationGeneration) {
        const failed = await dependencies.store.updateJobState({
          jobId: job.id,
          state: "FAILED",
          failureCode: "configuration_stale",
          ...(job.requestedByMembershipId
            ? {
                audit: {
                  actorMembershipId: job.requestedByMembershipId,
                  outcome: "failed" as const,
                  reason: "configuration_stale",
                  repositoryId: job.repositoryId,
                },
              }
            : {}),
        })
        return { terminal: true, job: failed }
      }
      try {
        let current = job
        if (job.state === "QUEUED") {
          const taskset = await dependencies.prepareTaskset({
            repositoryId: job.repositoryId,
            actorMembershipId: job.requestedByMembershipId ?? "",
          })
          if (
            taskset.tasksetDigest !== job.tasksetDigest ||
            taskset.questionDigest !== job.questionDigest ||
            taskset.exportDigest !== job.exportDigest ||
            taskset.repeatableReviewSnapshotDigest !== job.repeatableReviewSnapshotDigest ||
            taskset.buildSetDigest !== job.buildSetDigest
          ) {
            throw new DecisionModelError(
              409,
              "taskset_drift",
              "The pinned decision-model inputs changed before submission.",
            )
          }
          const transferred = await dependencies.runtime.transferTaskset({
            bytes: taskset.bytes,
            tasksetDigest: taskset.tasksetDigest,
            questionDigest: taskset.questionDigest,
            idempotencyKey: `${job.idempotencyKey}:taskset`,
          })
          const runtimeJob = await dependencies.runtime.submitTraining({
            backend: job.backend,
            maxUpdates: job.maxUpdates,
            maxSeconds: job.maxSeconds,
            maxCredits: job.budgetCredits,
            tasksetId: transferred.id,
            tasksetDigest: job.tasksetDigest,
            idempotencyKey: `${job.idempotencyKey}:job`,
          })
          if (runtimeJob.tasksetDigest !== job.tasksetDigest) {
            throw new DecisionModelError(
              409,
              "taskset_drift",
              "The decision runtime accepted a different taskset.",
            )
          }
          current = await dependencies.store.markJobSubmitted({
            jobId: job.id,
            runtimeJobId: runtimeJob.id,
            runtimeTasksetId: transferred.id,
          })
          if (current.state === "CANCELLED") {
            await dependencies.runtime.cancelTrainingJob({
              id: runtimeJob.id,
              idempotencyKey: `${job.idempotencyKey}:cancel-after-submit`,
            })
            return { terminal: true, job: current }
          }
          if (current.state === "FAILED" || current.state === "SUCCEEDED") {
            return { terminal: true, job: current }
          }
        }
        if (!current.runtimeJobId) {
          throw new DecisionModelError(
            503,
            "runtime_unavailable",
            "The decision runtime job reference is unavailable.",
          )
        }
        const runtimeJob = await dependencies.runtime.getTrainingJob(current.runtimeJobId)
        if (runtimeJob.tasksetDigest !== current.tasksetDigest) {
          throw new DecisionModelError(
            409,
            "taskset_drift",
            "The decision runtime job no longer matches the pinned taskset.",
          )
        }
        if (runtimeJob.state === "queued" || runtimeJob.state === "running") {
          const updated = await dependencies.store.updateJobState({
            jobId: current.id,
            state: runtimeJob.state === "queued" ? "SUBMITTED" : "RUNNING",
            usage: runtimeJob.usage,
          })
          return {
            terminal: ["SUCCEEDED", "FAILED", "CANCELLED"].includes(updated.state),
            job: updated,
          }
        }
        if (runtimeJob.state === "failed" || runtimeJob.state === "cancelled") {
          const terminal = await dependencies.store.updateJobState({
            jobId: current.id,
            state: runtimeJob.state === "failed" ? "FAILED" : "CANCELLED",
            failureCode: runtimeJob.error?.code,
            usage: runtimeJob.usage,
            ...(current.requestedByMembershipId
              ? {
                  audit: {
                    actorMembershipId: current.requestedByMembershipId,
                    outcome:
                      runtimeJob.state === "failed" ? ("failed" as const) : ("cancelled" as const),
                    repositoryId: current.repositoryId,
                    ...(runtimeJob.error?.code ? { reason: runtimeJob.error.code } : {}),
                  },
                }
              : {}),
          })
          return { terminal: true, job: terminal }
        }
        if (!runtimeJob.candidateId) {
          throw new DecisionRuntimeError(
            "invalid_response",
            "The completed decision runtime job did not name a candidate.",
          )
        }
        const candidate = await dependencies.runtime.getCandidate(runtimeJob.candidateId)
        if (candidate.tasksetDigest !== current.tasksetDigest) {
          throw new DecisionModelError(
            409,
            "taskset_drift",
            "The decision candidate does not match the pinned taskset.",
          )
        }
        const completed = await dependencies.store.completeJobWithCandidate({
          repositoryId: current.repositoryId,
          trainingJobId: current.id,
          runtimeCandidateId: candidate.id,
          tasksetDigest: candidate.tasksetDigest,
          manifestDigest: candidate.manifestDigest,
          evaluationDigest: candidate.evaluationDigest,
          productionEligible: candidate.productionEligible,
          meanRewardDelta: candidate.evidence.meanRewardDelta,
          calibrationErrorDelta: candidate.evidence.calibrationErrorDelta,
          usage: candidate.usage,
          jobUsage: runtimeJob.usage,
          actorMembershipId: current.requestedByMembershipId ?? undefined,
        })
        return { terminal: true, job: completed.job }
      } catch (error) {
        if (error instanceof DecisionModelError && error.code === "taskset_drift") {
          const failed = await dependencies.store.updateJobState({
            jobId: job.id,
            state: "FAILED",
            failureCode: error.code,
            ...(job.requestedByMembershipId
              ? {
                  audit: {
                    actorMembershipId: job.requestedByMembershipId,
                    outcome: "failed" as const,
                    reason: error.code,
                    repositoryId: job.repositoryId,
                  },
                }
              : {}),
          })
          return { terminal: true, job: failed }
        }
        throw error
      }
    },
  )
}
