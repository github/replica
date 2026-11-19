import type {
  AgentEvaluationAuthority,
  AgentEvaluationResult,
  AgentEvaluationScreenshot,
} from "../../../../domains/decision-model/types.ts"

export interface AgentVisualCriticRouteDependencies {
  authorize(input: {
    token: string
    sessionId: string
    branch: string
    commitSha: string
  }): Promise<AgentEvaluationAuthority>
  evaluate(input: {
    authority: AgentEvaluationAuthority
    currentRoute: string | null
    screenshots: AgentEvaluationScreenshot[]
  }): Promise<AgentEvaluationResult>
}
