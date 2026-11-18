import { withTelemetrySpan } from "../../../integrations/opentelemetry/with-telemetry-span/index.ts"
import { DecisionModelError } from "../errors.ts"
import type { DecisionModelDependencies } from "../types.ts"

export async function requestDecisionTraining(
  input: {
    repositoryId: string
    actorMembershipId: string
    idempotencyKey: string
  },
  dependencies: DecisionModelDependencies,
) {
  return withTelemetrySpan(
    "decision.training.request",
    { "replica.repository.id": input.repositoryId },
    async () => {
      await dependencies.authorization.requireRepositoryAdministrator({
        membershipId: input.actorMembershipId,
        repositoryId: input.repositoryId,
      })
      const configuration = await dependencies.store.getConfiguration(input.repositoryId)
      if (!configuration?.enabled) {
        throw new DecisionModelError(
          409,
          "configuration_disabled",
          "Decision-model training is not enabled for this repository.",
        )
      }
      const since = new Date(dependencies.now())
      since.setUTCDate(1)
      since.setUTCHours(0, 0, 0, 0)
      const usage = await dependencies.store.getMonthlyUsageCredits(input.repositoryId, since)
      if (Number(usage) >= Number(configuration.monthlyBudgetCredits)) {
        throw new DecisionModelError(
          409,
          "budget_exceeded",
          "The repository decision-model budget has been reached.",
        )
      }
      const taskset = await dependencies.prepareTaskset(input)
      if (!taskset.consentGrantId) {
        throw new DecisionModelError(
          409,
          "consent_required",
          "An active training-purpose consent grant is required.",
        )
      }
      const result = await dependencies.store.createOrGetJob({
        repositoryId: input.repositoryId,
        requestedByMembershipId: input.actorMembershipId,
        idempotencyKey: input.idempotencyKey,
        configurationGeneration: configuration.generation,
        settings: configuration,
        taskset,
      })
      if (result.created) {
        await dependencies.audit.write({
          type: "decision_training",
          outcome: "requested",
          actorMembershipId: input.actorMembershipId,
          repositoryId: input.repositoryId,
          jobId: result.job.id,
        })
      }
      return result
    },
  )
}
