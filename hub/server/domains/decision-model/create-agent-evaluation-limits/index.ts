import { DecisionModelError } from "../errors.ts"
import type { AgentEvaluationLimits } from "../types.ts"

export function createAgentEvaluationLimits({
  reserve,
  repositoryRequestsPerMinute = 30,
  sessionRequestsPerMinute = 6,
}: {
  reserve: (input: { limit: number; operation: string; subject: string }) => Promise<boolean>
  repositoryRequestsPerMinute?: number
  sessionRequestsPerMinute?: number
}): AgentEvaluationLimits {
  async function check(operation: string, subject: string, limit: number) {
    if (!(await reserve({ limit, operation, subject }))) {
      throw new DecisionModelError(
        429,
        "rate_limited",
        "Prototype evaluation is temporarily rate limited.",
      )
    }
  }

  return {
    async checkRate({ sessionKey, repositoryId }) {
      await check("decision-agent-session", sessionKey, sessionRequestsPerMinute)
      await check("decision-agent-repository", repositoryId, repositoryRequestsPerMinute)
    },
  }
}
