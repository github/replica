import { DecisionModelError } from "../errors.ts"
import { processDecisionTrainingJob } from "../process-decision-training-job/index.ts"
import type { DecisionModelDependencies } from "../types.ts"

export async function cancelDecisionTraining(
  input: {
    repositoryId: string
    jobId: string
    actorMembershipId: string
  },
  dependencies: DecisionModelDependencies,
) {
  await dependencies.authorization.requireRepositoryAdministrator({
    membershipId: input.actorMembershipId,
    repositoryId: input.repositoryId,
  })
  const job = await dependencies.store.getJob(input.repositoryId, input.jobId)
  if (!job) throw new DecisionModelError(404, "job_not_found", "Training job not found.")
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state)) return job
  if (job.runtimeJobId) {
    const runtimeJob = await dependencies.runtime.cancelTrainingJob({
      id: job.runtimeJobId,
      idempotencyKey: `${job.idempotencyKey}:cancel`,
    })
    if (runtimeJob.state === "succeeded") {
      return (
        await processDecisionTrainingJob(
          { repositoryId: input.repositoryId, jobId: input.jobId },
          dependencies,
        )
      ).job
    }
    if (runtimeJob.state === "failed") {
      return dependencies.store.updateJobState({
        jobId: job.id,
        state: "FAILED",
        failureCode: runtimeJob.error?.code,
        usage: runtimeJob.usage,
        audit: {
          actorMembershipId: input.actorMembershipId,
          outcome: "failed",
          repositoryId: input.repositoryId,
          ...(runtimeJob.error?.code ? { reason: runtimeJob.error.code } : {}),
        },
      })
    }
    if (runtimeJob.state !== "cancelled") {
      throw new DecisionModelError(
        409,
        "runtime_unavailable",
        "The decision runtime did not cancel the training job.",
      )
    }
  }
  return dependencies.store.updateJobState({
    jobId: job.id,
    state: "CANCELLED",
    audit: {
      actorMembershipId: input.actorMembershipId,
      outcome: "cancelled",
      repositoryId: input.repositoryId,
    },
  })
}
