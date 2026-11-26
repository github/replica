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
  title: string | null
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
  title: string | null
  content: string | null
  digest: string | null
  acceptedBy: string | null
  acceptedAt: string | null
  edited: boolean
  lastDecision: "accepted" | "edited" | "reinstated"
  status: "recalled" | "not-recalled" | "budget-excluded" | "damaged" | "identity-review"
  shared: boolean
}

export interface SharedLearningResponse {
  id: string
  title: string | null
  content: string | null
  source: string
  sharedBy: string | null
  sharedAt: string
  status: "recalled" | "budget-excluded"
}

export interface RejectedLearningResponse {
  id: string
  title: string | null
  content: string | null
  digest: string | null
  state: "rejected" | "retired"
  decidedBy: string | null
  decidedAt: string | null
  reason: string | null
  shared: boolean
}

export interface AppliedLearningResponse {
  id: string
  title: string | null
  version: number | null
  before?: { sha256: string; route: string }
  after?: { sha256: string; route: string }
}

export interface AppliedLearningsResponse {
  learnings: AppliedLearningResponse[]
}

export interface LearningHistoryResponse {
  decisions: Array<{
    version: number
    state: "proposed" | "accepted" | "rejected" | "retired"
    change: "proposed" | "accepted" | "edited" | "reinstated" | "rejected" | "retired"
    by: string | null
    at: string | null
    reason: string | null
  }>
  evidence: LearningEvidenceResponse[]
  otherEvidenceCount: number
  contradictions: LearningEvidenceResponse[]
  otherContradictionsCount: number
  outcomes: LearningOutcomeResponse[]
  /** Wording agents were given before the current version, newest first. */
  earlierGuidance: Array<{
    version: number
    title: string | null
    content: string
    outcomes: LearningOutcomeResponse[]
  }>
  /** Suggested new wording waiting for an administrator. */
  updates: LearningUpdateResponse[]
  /** Whether the last check found too few scored uses to suggest new wording. */
  updateNeedsMoreEvidence: boolean
}

/** Suggested new wording, drafted because scored uses kept showing the same issue. */
export interface LearningUpdateResponse {
  id: string
  issue: string
  title: string | null
  content: string
  reasoning: string
  /** The Builds whose scores showed the issue. */
  support: LearningOutcomeResponse["build"][]
}

/** How one use of a learning was scored, with the Build it judged. */
export interface LearningOutcomeResponse {
  id: string
  /** Whether a reviewer confirmed the work before it was scored. */
  source: "automated" | "reviewer_confirmed"
  /** 4 is best. 1 and 2 come with an issue. */
  efficiency: number
  followed: "followed" | "not_followed" | "unclear"
  reasoning: string
  issue: string | null
  scoredAt: string
  build: { prototypeId: string; prototypeName: string; number: number }
  before?: { sha256: string; route: string }
  after?: { sha256: string; route: string }
}

/** A day's learning runs, kept for a year after the runs themselves are deleted. */
export interface LearningActivityDayResponse {
  date: string
  runState: "succeeded" | "failed"
  startedAt: string
  startedBy: LearningRunResponse["startedBy"]
  commentsAnalyzed: number
  commentsTagged: number
  suggestions: number
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
  | {
      accessDenied: true
      repository: RepositoryRecord
      capabilities: { administerHub: boolean; administerRepository: false }
    }
  | {
      accessDenied: false
      repository: RepositoryRecord
      capabilities: { administerHub: boolean; administerRepository: boolean }
      permissions: {
        viewEvidence: boolean
        decide: boolean
        requestRun: boolean
        share: boolean
      }
      copilot:
        | { state: "connected"; connectedBy: string | null }
        | { state: "not-connected" }
        | { state: "refused"; refusedAt: string | null }
      automaticRunsEnabled: boolean
      usageCredits: string | null
      runAvailable: boolean
      loadError: string | null
      identityReviewCount: number
      suggestions: LearningSuggestionResponse[]
      learnings: AcceptedLearningResponse[]
      rejected: RejectedLearningResponse[]
      shared: SharedLearningResponse[]
      recall: { text: string; count: number }
      runs: LearningRunResponse[]
      activity: LearningActivityDayResponse[]
      today: string
    }

export type LearningDecisionInput =
  | { decision: "accept"; digest: string; content?: string }
  | { decision: "reject"; digest: string; reason: string }
  | { decision: "retire"; reason: string }
  | { decision: "edit"; digest: string; title?: string; content?: string; reason: string }
  | { decision: "reinstate"; digest: string; reason: string }
  | {
      decision: "apply_update"
      proposalId: string
      title?: string
      content?: string
      reason: string
    }
  | { decision: "dismiss_update"; proposalId: string; reason: string }

export interface LearningShareInput {
  shared: boolean
}

export interface LearningMutationResponse {
  notice: string
}

export interface EvaluationSettingsResponse {
  repository: { id: string; nameWithOwner: string; defaultBranch: string }
  monthlyBudgetCredits: string
  usedCredits: string
  enabled: boolean
  screenshots: { allowed: boolean; changedBy: string | null; changedAt: string | null }
  permissions: { changeBudget: boolean; changeRepository: boolean }
}
