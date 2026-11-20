import { createHash } from "node:crypto"

import { withTelemetrySpan } from "../../../integrations/opentelemetry/with-telemetry-span/index.ts"
import { DecisionModelError } from "../errors.ts"
import type { DecisionModelDependencies } from "../types.ts"
import { resolveDecisionRuntime } from "../resolve-decision-runtime/index.ts"

export async function evaluateBuildWithDecisionModel(
  input: { repositoryId: string; buildId: string; actorMembershipId: string },
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
      if (
        await dependencies.store.isCandidateRevoked?.(input.repositoryId, promotion.candidateId)
      ) {
        throw new DecisionModelError(
          409,
          "deletion_revoked",
          "Decision-model use is blocked by a runtime deletion.",
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
      const result = await resolveDecisionRuntime(dependencies, input.repositoryId).evaluate({
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
      const findings = result.evaluations.map((evaluation) => {
        return {
          learning: { id: evaluation.learningId },
          route: prepared.route,
          views: prepared.views,
          followsProbability: evaluation.followsProbability,
          breaksProbability: evaluation.breaksProbability,
          explanation:
            evaluation.breaksProbability > evaluation.followsProbability
              ? "Across the submitted captured views, the promoted decision model found the Build more likely to break the learning than follow it."
              : "Across the submitted captured views, the promoted decision model found the Build at least as likely to follow the learning as break it.",
        }
      })
      const saved = await dependencies.store.saveBuildEvaluation({
        repositoryId: input.repositoryId,
        buildId: input.buildId,
        candidateId: promotion.candidateId,
        actorMembershipId: input.actorMembershipId,
        promotionGeneration: promotion.runtimeGeneration,
        questionDigest: prepared.questionDigest,
        screenshotSetDigest: prepared.screenshotSetDigest,
        runtimeEvaluationId: result.id,
        responseDigest: result.responseDigest,
        summary: { findings },
        usage: result.usage,
      })
      return {
        ...result,
        runtimeEvaluationId: result.id ?? null,
        id: saved.id,
      }
    },
  )
}
