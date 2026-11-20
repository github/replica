import type {
  AgentEvaluationAuthority,
  AgentEvaluationResult,
  AgentEvaluationScreenshot,
} from "../../../../domains/decision-model/types.ts"

export interface AgentVisualCriticRouteDependencies {
  evaluate(input: {
    authority: AgentEvaluationAuthority
    currentRoute: string | null
    screenshots: AgentEvaluationScreenshot[]
  }): Promise<AgentEvaluationResult>
}
