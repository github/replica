import type { DecisionTrainingPreflight } from "../types.ts"
import type { DecisionTasksetPreparationSource } from "../prepare-decision-taskset/index.ts"

export function preflightDecisionTaskset(
  input: { repositoryId: string; actorMembershipId: string },
  source: Pick<DecisionTasksetPreparationSource, "preflight">,
): Promise<DecisionTrainingPreflight> {
  return source.preflight(input)
}
