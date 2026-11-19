import type { DecisionModelDependencies } from "../types.ts"
import { DecisionModelError } from "../errors.ts"
import { resolveDecisionRuntime } from "../resolve-decision-runtime/index.ts"

export async function rejectDecisionCandidate(
  input: {
    repositoryId: string
    candidateId: string
    actorMembershipId: string
    reason: string
  },
  dependencies: DecisionModelDependencies,
) {
  await dependencies.authorization.requireRepositoryAdministrator({
    membershipId: input.actorMembershipId,
    repositoryId: input.repositoryId,
  })
  return dependencies.withControlLock(async (signal) => {
    const runtime = resolveDecisionRuntime(dependencies, input.repositoryId)
    const candidate = await dependencies.store.getCandidate(input.repositoryId, input.candidateId)
    if (!candidate) {
      return dependencies.store.rejectCandidate({
        repositoryId: input.repositoryId,
        candidateId: input.candidateId,
        rejectedByMembershipId: input.actorMembershipId,
        reason: input.reason,
      })
    }
    const promotion = await runtime.getPromotion(signal)
    if (promotion.candidateId === candidate.runtimeCandidateId) {
      throw new DecisionModelError(
        409,
        "candidate_already_promoted",
        "A promoted decision candidate cannot be rejected.",
      )
    }
    signal.throwIfAborted()
    return dependencies.store.rejectCandidate({
      repositoryId: input.repositoryId,
      candidateId: input.candidateId,
      rejectedByMembershipId: input.actorMembershipId,
      reason: input.reason,
    })
  })
}
