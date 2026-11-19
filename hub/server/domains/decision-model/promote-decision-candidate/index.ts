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
  return dependencies.withControlLock(async (signal) => {
    const candidate = await dependencies.store.getCandidate(input.repositoryId, input.candidateId)
    if (!candidate) {
      throw new DecisionModelError(404, "candidate_not_found", "Decision candidate not found.")
    }
    if (candidate.rejectedAt) {
      throw new DecisionModelError(
        409,
        "candidate_rejected",
        "A rejected decision candidate cannot be promoted.",
      )
    }
    const current = await dependencies.store.getPromotion(input.repositoryId)
    if ((current?.runtimeGeneration ?? 0) !== input.expectedGeneration) {
      throw new DecisionModelError(
        409,
        "promotion_stale",
        "The promoted decision model changed. Refresh and try again.",
      )
    }
    const remote = await dependencies.runtime.getPromotion(signal)
    let promotion = remote
    if (remote.generation === input.expectedGeneration) {
      promotion = await dependencies.runtime.promote({
        candidateId: candidate.runtimeCandidateId,
        promotedBy: input.actorLogin,
        expectedGeneration: input.expectedGeneration,
        idempotencyKey: randomUUID(),
        signal,
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
    signal.throwIfAborted()
    const saved = await dependencies.store.savePromotion({
      repositoryId: input.repositoryId,
      candidateId: candidate.id,
      previousCandidateId: current?.candidateId ?? null,
      promotedByMembershipId: input.actorMembershipId,
      runtimeGeneration: promotion.generation,
      operation: "PROMOTE",
    })
    return saved
  })
}
