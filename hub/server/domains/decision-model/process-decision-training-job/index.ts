import { DecisionRuntimeError } from "../../../integrations/decision-runtime/create-decision-runtime-client/errors.ts"
import { withTelemetrySpan } from "../../../integrations/opentelemetry/with-telemetry-span/index.ts"
import { DecisionModelError } from "../errors.ts"
import type { DecisionModelDependencies, DecisionTrainingJobRecord } from "../types.ts"
import { resolveDecisionRuntime } from "../resolve-decision-runtime/index.ts"

function runtimeDurationSeconds(input: {
  startedAt?: string
  completedAt?: string
}): number | undefined {
  if (!input.startedAt || !input.completedAt) return undefined
  const startedAt = Date.parse(input.startedAt)
  const completedAt = Date.parse(input.completedAt)
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    return undefined
  }
  return (completedAt - startedAt) / 1_000
}

async function cancelOrReadRuntimeJob(
  runtime: ReturnType<typeof resolveDecisionRuntime>,
  input: { id: string; idempotencyKey: string },
) {
  try {
    return await runtime.cancelTrainingJob(input)
  } catch (error) {
    if (error instanceof DecisionRuntimeError && error.code === "conflict") {
      return runtime.getTrainingJob(input.id)
    }
    throw error
  }
}

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
      const runtime = resolveDecisionRuntime(dependencies, input.repositoryId)
      const overdue =
        dependencies.now().getTime() - job.createdAt.getTime() > (job.maxSeconds + 300) * 1_000
      if (job.state === "QUEUED" && overdue) {
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
      const configuration =
        job.state === "QUEUED"
          ? await dependencies.store.getConfiguration(input.repositoryId)
          : null
      if (
        job.state === "QUEUED" &&
        (!configuration || configuration.generation !== job.configurationGeneration)
      ) {
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
          current = await dependencies.store.markJobSubmitting(job.id)
          if (current.state === "CANCELLED") return { terminal: true, job: current }
        }
        if (current.state === "SUBMITTING" || current.state === "CANCEL_REQUESTED") {
          if (
            await dependencies.store.isTasksetRevoked?.({
              repositoryId: job.repositoryId,
              exportId: job.trainingExportId,
              grantId: job.consentGrantId,
              evidenceDigest: job.evidenceDigest,
              tasksetDigest: job.tasksetDigest,
            })
          ) {
            throw new DecisionModelError(
              409,
              "deletion_revoked",
              "Decision-model use is blocked by a runtime deletion.",
            )
          }
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
          const transferred = await runtime.transferTaskset({
            upload: taskset.upload,
            tasksetDigest: taskset.tasksetDigest,
            idempotencyKey: `taskset:${job.id}`,
          })
          if (transferred.tasksetDigest !== job.tasksetDigest) {
            throw new DecisionModelError(
              409,
              "taskset_drift",
              "The decision runtime stored a different taskset.",
            )
          }
          const runtimeJob = await runtime.submitTraining({
            backend: job.backend,
            maxUpdates: job.maxUpdates,
            maxSeconds: job.maxSeconds,
            maxCredits: job.budgetCredits,
            tasksetDigest: job.tasksetDigest,
            idempotencyKey: `submit:${job.id}`,
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
            runtimeTasksetId: transferred.reference,
          })
          if (current.state === "CANCEL_REQUESTED" || overdue) {
            const cancelled = await cancelOrReadRuntimeJob(runtime, {
              id: runtimeJob.id,
              idempotencyKey: `cancel:${job.id}`,
            })
            return {
              terminal: true,
              job: await dependencies.store.updateJobState({
                jobId: current.id,
                state: cancelled.state === "failed" || overdue ? "FAILED" : "CANCELLED",
                failureCode: overdue
                  ? "polling_deadline_exceeded"
                  : cancelled.state === "failed"
                    ? cancelled.error?.code
                    : undefined,
                usage: cancelled.usage,
                ...(current.requestedByMembershipId
                  ? {
                      audit: {
                        actorMembershipId: current.requestedByMembershipId,
                        outcome:
                          cancelled.state === "failed" || overdue
                            ? ("failed" as const)
                            : ("cancelled" as const),
                        ...(overdue ? { reason: "polling_deadline_exceeded" } : {}),
                        repositoryId: current.repositoryId,
                      },
                    }
                  : {}),
              }),
            }
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
        if (
          current.requestedByMembershipId &&
          !(await dependencies.hasTrainingConsent({
            repositoryId: current.repositoryId,
            actorMembershipId: current.requestedByMembershipId,
            consentGrantId: current.consentGrantId,
          }))
        ) {
          const cancelled = await cancelOrReadRuntimeJob(runtime, {
            id: current.runtimeJobId,
            idempotencyKey: `cancel:${current.id}`,
          })
          return {
            terminal: true,
            job: await dependencies.store.updateJobState({
              jobId: current.id,
              state: cancelled.state === "failed" ? "FAILED" : "CANCELLED",
              failureCode: "consent_withdrawn",
              usage: cancelled.usage,
              audit: {
                actorMembershipId: current.requestedByMembershipId,
                outcome: cancelled.state === "failed" ? "failed" : "cancelled",
                reason: "consent_withdrawn",
                repositoryId: current.repositoryId,
              },
            }),
          }
        }
        const runtimeJob = await runtime.getTrainingJob(current.runtimeJobId)
        if (runtimeJob.tasksetDigest !== current.tasksetDigest) {
          throw new DecisionModelError(
            409,
            "taskset_drift",
            "The decision runtime job no longer matches the pinned taskset.",
          )
        }
        if (overdue) {
          const terminal =
            runtimeJob.state === "queued" || runtimeJob.state === "running"
              ? await cancelOrReadRuntimeJob(runtime, {
                  id: current.runtimeJobId,
                  idempotencyKey: `cancel:${current.id}`,
                })
              : runtimeJob
          return {
            terminal: true,
            job: await dependencies.store.updateJobState({
              jobId: current.id,
              state: "FAILED",
              failureCode: "polling_deadline_exceeded",
              usage: terminal.usage,
              ...(current.requestedByMembershipId
                ? {
                    audit: {
                      actorMembershipId: current.requestedByMembershipId,
                      outcome: "failed" as const,
                      reason: "polling_deadline_exceeded",
                      repositoryId: current.repositoryId,
                    },
                  }
                : {}),
            }),
          }
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
        const candidate = await runtime.getCandidate(runtimeJob.candidateId)
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
          baselineMeanReward: candidate.evidence.baselineMeanReward,
          candidateMeanReward: candidate.evidence.candidateMeanReward,
          meanRewardDelta: candidate.evidence.meanRewardDelta,
          baselineCalibrationError: candidate.evidence.baselineCalibrationError,
          candidateCalibrationError: candidate.evidence.candidateCalibrationError,
          calibrationErrorDelta: candidate.evidence.calibrationErrorDelta,
          learningMetrics: candidate.evidence.learningMetrics,
          durationSeconds: runtimeDurationSeconds(runtimeJob),
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
