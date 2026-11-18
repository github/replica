import { randomUUID } from "node:crypto"

import { DecisionModelError } from "../errors.ts"
import type { DecisionModelDependencies } from "../types.ts"

export async function rollbackDecisionCandidate(
  input: {
    repositoryId: string
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
  const current = await dependencies.store.getPromotion(input.repositoryId)
  if (!current || current.runtimeGeneration !== input.expectedGeneration) {
    throw new DecisionModelError(
      409,
      "promotion_stale",
      "The promoted decision model changed. Refresh and try again.",
    )
  }
  if (!current.previousCandidateId || !current.previousRuntimeCandidateId) {
    throw new DecisionModelError(
      409,
      "rollback_unavailable",
      "The current decision model has no previous candidate to restore.",
    )
  }
  const remote = await dependencies.runtime.getPromotion()
  let promotion = remote
  if (remote.generation === input.expectedGeneration) {
    promotion = await dependencies.runtime.rollback({
      rolledBackBy: input.actorLogin,
      expectedGeneration: input.expectedGeneration,
      idempotencyKey: randomUUID(),
    })
  } else if (
    remote.generation !== input.expectedGeneration + 1 ||
    remote.candidateId !== current.previousRuntimeCandidateId
  ) {
    throw new DecisionModelError(
      409,
      "promotion_stale",
      "The decision runtime promotion changed. Refresh and try again.",
    )
  }
  if (
    promotion.generation !== input.expectedGeneration + 1 ||
    promotion.candidateId !== current.previousRuntimeCandidateId
  ) {
    throw new DecisionModelError(
      409,
      "promotion_stale",
      "The decision runtime returned an unexpected rollback generation.",
    )
  }
  const candidate = await dependencies.store.getCandidate(input.repositoryId, promotion.candidateId)
  if (!candidate) {
    throw new DecisionModelError(
      404,
      "candidate_not_found",
      "The rollback candidate is not recorded in Hub.",
    )
  }
  const saved = await dependencies.store.savePromotion({
    repositoryId: input.repositoryId,
    candidateId: candidate.id,
    previousCandidateId: current.candidateId,
    promotedByMembershipId: input.actorMembershipId,
    runtimeGeneration: promotion.generation,
    operation: "ROLLBACK",
  })
  return saved
}
