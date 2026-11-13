import type { CurrentSessionDependencies } from "../auth/types.ts"

export interface LearningEvidence {
  eventId: string
  commentId: number
  body: string | null
  authorLogin: string
  authorAvatarUrl: string | null
  prototypeId: string
  prototypeName: string
  createdAt: string
}

export interface LearningSuggestion {
  id: string
  content: string
  reviewDigest: string
  support: { reviewers: number; prototypes: number } | null
  replaces: Array<{ id: string; content: string | null }>
  evidence: LearningEvidence[]
  otherEvidenceCount: number
  contradictions: LearningEvidence[]
  otherContradictionsCount: number
}

export interface AcceptedLearning {
  id: string
  content: string | null
  acceptedBy: string | null
  acceptedAt: string | null
  edited: boolean
  status: "recalled" | "not-recalled" | "budget-excluded" | "damaged" | "identity-review"
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

export type LearningDecision =
  | { decision: "accept"; digest: string; content?: string }
  | { decision: "reject"; digest: string; reason: string }
  | { decision: "retire"; reason: string }

export interface LearningsRouteDependencies {
  applicationOrigin: string
  currentSession: CurrentSessionDependencies
  findRepository(repositoryId: string): Promise<{
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
}
