import { randomUUID } from "node:crypto"

import { DecisionModelError } from "../errors.ts"
import type { DecisionModelDependencies } from "../types.ts"

export async function promoteDecisionCandidate(
  input: {
    repositoryId: string
    candidateId: string
    actorMembershipId: string
    actorLogin: string
    expectedGeneration: number
  },
  dependencies: DecisionModelDependencies,
) {
  await dependencies.authorization.requireRepositoryAdministrator({
    membershipId: input.actorMembershipId,
    repositoryId: input.repositoryId,
  })
  const candidate = await dependencies.store.getCandidate(input.repositoryId, input.candidateId)
  if (!candidate) {
    throw new DecisionModelError(404, "candidate_not_found", "Decision candidate not found.")
  }
  const current = await dependencies.store.getPromotion(input.repositoryId)
  if ((current?.runtimeGeneration ?? 0) !== input.expectedGeneration) {
    throw new DecisionModelError(
      409,
      "promotion_stale",
      "The promoted decision model changed. Refresh and try again.",
    )
  }
  const remote = await dependencies.runtime.getPromotion()
  let promotion = remote
  if (remote.generation === input.expectedGeneration) {
    promotion = await dependencies.runtime.promote({
      candidateId: candidate.runtimeCandidateId,
      promotedBy: input.actorLogin,
      expectedGeneration: input.expectedGeneration,
      idempotencyKey: randomUUID(),
    })
  } else if (
    remote.generation !== input.expectedGeneration + 1 ||
    remote.candidateId !== candidate.runtimeCandidateId
  ) {
    throw new DecisionModelError(
      409,
      "promotion_stale",
      "The decision runtime promotion changed. Refresh and try again.",
    )
  }
  if (
    promotion.generation !== input.expectedGeneration + 1 ||
    promotion.candidateId !== candidate.runtimeCandidateId
  ) {
    throw new DecisionModelError(
      409,
      "promotion_stale",
      "The decision runtime returned an unexpected promotion generation.",
    )
  }
  const saved = await dependencies.store.savePromotion({
    repositoryId: input.repositoryId,
    candidateId: candidate.id,
    previousCandidateId: current?.candidateId ?? null,
    promotedByMembershipId: input.actorMembershipId,
    runtimeGeneration: promotion.generation,
    operation: "PROMOTE",
  })
  await dependencies.audit.write({
    type: "decision_promotion",
    operation: "promote",
    outcome: "succeeded",
    actorMembershipId: input.actorMembershipId,
    repositoryId: input.repositoryId,
    candidateId: candidate.id,
    generation: promotion.generation,
  })
  return saved
}
