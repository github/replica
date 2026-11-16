import type { CurrentSessionDependencies } from "../auth/types.ts"
import type { ProductViewer } from "../product/types.ts"
import type {
  AcceptedLearning,
  LearningDecision,
  LearningEvidence,
  LearningSuggestion,
} from "../../../domains/learning/types.ts"

export type { AcceptedLearning, LearningDecision, LearningEvidence, LearningSuggestion }

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

export interface LearningsRouteDependencies {
  applicationOrigin: string
  currentSession: CurrentSessionDependencies
  findRepository(
    viewer: ProductViewer,
    repositoryId: string,
  ): Promise<{
    id: string
    nameWithOwner: string
    defaultBranch: string
  } | null>
  getOverview(input: { repositoryId: string; viewer: string }): Promise<{
    loadError: string | null
    identityReviewCount: number
    suggestions: LearningSuggestion[]
    learnings: AcceptedLearning[]
    recall: { text: string; count: number }
  }>
  getCopilot(): Promise<
    | { state: "connected"; connectedBy: string | null }
    | { state: "not-connected" }
    | { state: "refused"; refusedAt: string | null }
  >
  listRuns(repositoryId: string): Promise<{
    runs: LearningRun[]
    usageCredits: string
    active: boolean
  }>
  requestRun?: (input: {
    actorMembershipId: string
    repositoryId: string
    requestedById: string
  }) => Promise<{ notice: string }>
  decide(input: {
    repositoryId: string
    learningId: string
    actor: string
    actorMembershipId: string
    decision: LearningDecision
  }): Promise<{ notice: string }>
  redactComment(input: {
    repositoryId: string
    commentId: number
    actorLogin: string
  }): Promise<void>
  serializeReviewCommentDeletion<T>(operation: () => Promise<T>): Promise<T>
}
