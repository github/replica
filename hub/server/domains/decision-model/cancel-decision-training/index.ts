import { DecisionModelError } from "../errors.ts"
import { processDecisionTrainingJob } from "../process-decision-training-job/index.ts"
import { DecisionRuntimeError } from "../../../integrations/decision-runtime/create-decision-runtime-client/errors.ts"
import type { DecisionModelDependencies } from "../types.ts"
import { resolveDecisionRuntime } from "../resolve-decision-runtime/index.ts"

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
  const runtime = resolveDecisionRuntime(dependencies, input.repositoryId)
  if (!job.runtimeJobId) {
    return (
      await dependencies.store.requestCancellation({
        jobId: job.id,
        actorMembershipId: input.actorMembershipId,
        repositoryId: input.repositoryId,
      })
    ).job
  }
  let runtimeUsage: Awaited<ReturnType<typeof runtime.cancelTrainingJob>>["usage"]
  if (job.runtimeJobId) {
    let runtimeJob
    try {
      runtimeJob = await runtime.cancelTrainingJob({
        id: job.runtimeJobId,
        idempotencyKey: `cancel:${job.id}`,
      })
    } catch (error) {
      if (error instanceof DecisionRuntimeError && error.code === "conflict") {
        return (
          await processDecisionTrainingJob(
            { repositoryId: input.repositoryId, jobId: input.jobId },
            dependencies,
          )
        ).job
      }
      throw error
    }
    if (runtimeJob.state === "succeeded") {
      return (
        await processDecisionTrainingJob(
          { repositoryId: input.repositoryId, jobId: input.jobId },
          dependencies,
        )
      ).job
    }
    if (runtimeJob.state === "failed") {
      return dependencies.store.completeAdministratorCancellation({
        jobId: job.id,
        actorMembershipId: input.actorMembershipId,
        repositoryId: input.repositoryId,
        state: "FAILED",
        failureCode: runtimeJob.error?.code,
        usage: runtimeJob.usage,
      })
    }
    if (runtimeJob.state !== "cancelled") {
      throw new DecisionModelError(
        409,
        "runtime_unavailable",
        "The decision runtime did not cancel the training job.",
      )
    }
    runtimeUsage = runtimeJob.usage
  }
  return dependencies.store.completeAdministratorCancellation({
    jobId: job.id,
    actorMembershipId: input.actorMembershipId,
    repositoryId: input.repositoryId,
    state: "CANCELLED",
    usage: runtimeUsage,
  })
}
