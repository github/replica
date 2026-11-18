import { DecisionModelError } from "../errors.ts"
import type { DecisionModelAuthorization } from "../types.ts"

export function createCurrentAdministratorDecisionAuthorization(input: {
  isEffectiveAdministrator(membershipId: string): Promise<boolean>
  isRepositoryVisible(repositoryId: string): Promise<boolean>
}): DecisionModelAuthorization {
  return {
    async requireRepositoryAdministrator({ membershipId, repositoryId }) {
      if (!(await input.isEffectiveAdministrator(membershipId))) {
        throw new DecisionModelError(
          403,
          "access_denied",
          "Repository administrator access is required.",
        )
      }
      if (!(await input.isRepositoryVisible(repositoryId))) {
        throw new DecisionModelError(404, "access_denied", "Repository not found.")
      }
    },
  }
}
