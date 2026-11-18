import { DecisionModelError } from "../errors.ts"
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
    await dependencies.runtime.cancelTrainingJob({
      id: job.runtimeJobId,
      idempotencyKey: `${job.idempotencyKey}:cancel`,
    })
  }
  const cancelled = await dependencies.store.updateJobState({
    jobId: job.id,
    state: "CANCELLED",
  })
  await dependencies.audit.write({
    type: "decision_training",
    outcome: "cancelled",
    actorMembershipId: input.actorMembershipId,
    repositoryId: input.repositoryId,
    jobId: input.jobId,
  })
  return cancelled
}
