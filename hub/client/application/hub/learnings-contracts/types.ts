import type { RepositoryRecord } from "@application/hub/contracts/types"

export interface LearningEvidenceResponse {
  eventId: string
  commentId: number
  body: string | null
  authorLogin: string
  authorAvatarUrl: string | null
  prototypeId: string
  prototypeName: string
  createdAt: string
}

export interface LearningSuggestionResponse {
  id: string
  content: string
  reviewDigest: string
  support: { reviewers: number; prototypes: number } | null
  replaces: Array<{ id: string; content: string | null }>
  evidence: LearningEvidenceResponse[]
  otherEvidenceCount: number
  contradictions: LearningEvidenceResponse[]
  otherContradictionsCount: number
}

export interface AcceptedLearningResponse {
  id: string
  content: string | null
  acceptedBy: string | null
  acceptedAt: string | null
  edited: boolean
  status: "recalled" | "not-recalled" | "budget-excluded" | "damaged" | "identity-review"
}

export interface LearningRunResponse {
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

export type LearningsResponse =
  | { accessDenied: true; repository: RepositoryRecord; canAdministerHub: boolean }
  | {
      accessDenied: false
      repository: RepositoryRecord
      canAdministerHub: boolean
      permissions: { decide: boolean; requestRun: boolean }
      copilot:
        | { state: "connected"; connectedBy: string | null }
        | { state: "not-connected" }
        | { state: "refused"; refusedAt: string | null }
      usageCredits: string
      runAvailable: boolean
      loadError: string | null
      identityReviewCount: number
      suggestions: LearningSuggestionResponse[]
      learnings: AcceptedLearningResponse[]
      recall: { text: string; count: number }
      runs: LearningRunResponse[]
    }

export type LearningDecisionInput =
  | { decision: "accept"; digest: string; content?: string }
  | { decision: "reject"; digest: string; reason: string }
  | { decision: "retire"; reason: string }

export interface LearningMutationResponse {
  notice: string
}
