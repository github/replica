import { createHash } from "node:crypto"

import { withTelemetrySpan } from "../../../integrations/opentelemetry/with-telemetry-span/index.ts"
import { DecisionModelError } from "../errors.ts"
import type { DecisionModelDependencies } from "../types.ts"

export async function evaluateBuildWithDecisionModel(
  input: { repositoryId: string; buildId: string },
  dependencies: DecisionModelDependencies,
) {
  return withTelemetrySpan(
    "decision.build.evaluate",
    {
      "replica.repository.id": input.repositoryId,
      "replica.build.id": input.buildId,
    },
    async () => {
      const promotion = await dependencies.store.getPromotion(input.repositoryId)
      if (!promotion) {
        throw new DecisionModelError(
          409,
          "configuration_disabled",
          "No decision candidate is promoted for this repository.",
        )
      }
      const prepared = await dependencies.prepareBuildEvaluation(input)
      const idempotencyKey = `evaluation:${createHash("sha256")
        .update(
          [
            input.buildId,
            promotion.runtimeGeneration,
            prepared.questionDigest,
            prepared.screenshotSetDigest,
          ].join("\0"),
        )
        .digest("hex")}`
      const result = await dependencies.runtime.evaluate({
        state: prepared.state,
        images: prepared.images,
        questions: prepared.questions,
        idempotencyKey,
      })
      if (
        result.candidateId !== promotion.runtimeCandidateId ||
        result.generation !== promotion.runtimeGeneration
      ) {
        throw new DecisionModelError(
          409,
          "promotion_stale",
          "The promoted decision model changed during Build evaluation.",
        )
      }
      const saved = await dependencies.store.saveBuildEvaluation({
        repositoryId: input.repositoryId,
        buildId: input.buildId,
        candidateId: promotion.candidateId,
        promotionGeneration: promotion.runtimeGeneration,
        questionDigest: prepared.questionDigest,
        screenshotSetDigest: prepared.screenshotSetDigest,
        runtimeEvaluationId: result.id,
        responseDigest: result.responseDigest,
        summary: { evaluations: result.evaluations },
        usage: result.usage,
      })
      return { id: saved.id, ...result }
    },
  )
}
