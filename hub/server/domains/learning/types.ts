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

export type LearningDecision =
  | { decision: "accept"; digest: string; content?: string }
  | { decision: "reject"; digest: string; reason: string }
  | { decision: "retire"; reason: string }
