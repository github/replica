import { evaluatePrototypeWithDecisionModel } from "../../../../../domains/decision-model/evaluate-prototype-with-decision-model/index.ts"
import type {
  AgentEvaluationAuthority,
  AgentEvaluationDependencies,
} from "../../../../../domains/decision-model/types.ts"
import type { AgentVisualCriticRouteDependencies } from "../types.ts"

export function createAgentVisualCriticRouteDependencies(options: {
  authorize(input: {
    token: string
    sessionId: string
    branch: string
    commitSha: string
  }): Promise<AgentEvaluationAuthority>
  evaluation: AgentEvaluationDependencies
}): AgentVisualCriticRouteDependencies {
  return {
    authorize: (input) => options.authorize(input),
    evaluate: (input) => evaluatePrototypeWithDecisionModel(input, options.evaluation),
  }
}
