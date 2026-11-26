import type { CurrentSessionDependencies } from "../auth/types.ts"
import type { ProductViewer } from "../product/types.ts"
import type {
  AcceptedLearning,
  LearningDecision,
  LearningDecisionRecord,
  LearningEvidence,
  LearningSuggestion,
  RejectedLearning,
  SharedLearning,
} from "../../../domains/learning/types.ts"

export type {
  AcceptedLearning,
  LearningDecision,
  LearningDecisionRecord,
  LearningEvidence,
  LearningSuggestion,
  RejectedLearning,
  SharedLearning,
}

export interface LearningRun {
  id: number
  startedAt: string
  startedBy: { type: "daily" } | { type: "user"; login: string } | { type: "unknown" }
  state: "queued" | "running" | "succeeded" | "failed"
  result:
    | {
        type: "succeeded"
        commentsConsidered: number
        commentsLabeled: number
        commentsRemaining: number
        suggestions: number
        suggestionsRemaining: number
      }
    | { type: "failed"; summary: string }
    | null
  usage: { credits: string; requests: number } | null
}

export interface LearningActivityDay {
  date: string
  runState: "succeeded" | "failed"
  startedAt: string
  startedBy: LearningRun["startedBy"]
  commentsAnalyzed: number
  commentsTagged: number
  suggestions: number
}

export interface EvaluationSettings {
  monthlyBudgetCredits: string
  enabled: boolean
  screenshots: { allowed: boolean; changedBy: string | null; changedAt: string | null }
}

export interface LearningsRouteDependencies {
  applicationOrigin: string
  automaticRunsEnabled: boolean
  currentSession: CurrentSessionDependencies
  findRepository(
    viewer: ProductViewer,
    repositoryId: string,
  ): Promise<{
    id: string
    nameWithOwner: string
    defaultBranch: string
  } | null>
  authorizeRepositoryAdministration(input: {
    membershipId: string
    repositoryId: string
  }): Promise<boolean>
  auditRepositoryAdministrationDenial(input: {
    actorMembershipId: string
    operation:
      | "learning_overview"
      | "learning_run"
      | "learning_decision"
      | "learning_share"
      | "learning_evaluation"
    repositoryId: string
  }): Promise<void>
  getOverview(input: { repositoryId: string; viewer: string }): Promise<{
    loadError: string | null
    identityReviewCount: number
    suggestions: LearningSuggestion[]
    learnings: AcceptedLearning[]
    rejected: RejectedLearning[]
    shared: SharedLearning[]
    recall: { text: string; count: number }
  }>
  getHistory(input: { repositoryId: string; learningId: string }): Promise<{
    decisions: LearningDecisionRecord[]
    evidence: LearningEvidence[]
    otherEvidenceCount: number
  }>
  getCopilot(): Promise<
    | { state: "connected"; connectedBy: string | null }
    | { state: "not-connected" }
    | { state: "refused"; refusedAt: string | null }
  >
  listRuns(repositoryId: string): Promise<{
    runs: LearningRun[]
    usageCredits: string
    active: { scheduled: boolean; state: "QUEUED" | "RUNNING" } | null
  }>
  listActivity(repositoryId: string, from: Date): Promise<LearningActivityDay[]>
  requestRun?: (input: {
    actorMembershipId: string
    repositoryId: string
    requestedById: string
    sessionDigest: string
  }) => Promise<{ notice: string }>
  decide(input: {
    repositoryId: string
    learningId: string
    actor: string
    actorMembershipId: string
    decision: LearningDecision
    sessionDigest: string
  }): Promise<{ notice: string }>
  share(input: {
    repositoryId: string
    learningId: string
    actorMembershipId: string
    shared: boolean
    sessionDigest: string
  }): Promise<{ notice: string }>
  getEvaluationSettings(repositoryId: string): Promise<EvaluationSettings>
  changeEvaluationSettings(input: {
    repositoryId: string
    actor: string
    actorMembershipId: string
    sessionDigest: string
    enabled?: boolean
    screenshots?: boolean
  }): Promise<{ notice: string }>
  changeEvaluationBudget(input: {
    actorMembershipId: string
    monthlyBudgetCredits: string
  }): Promise<{ notice: string }>
  redactComment(input: {
    repositoryId: string
    commentId: number
    actorLogin: string
  }): Promise<void>
  serializeReviewCommentDeletion<T>(operation: () => Promise<T>): Promise<T>
}
