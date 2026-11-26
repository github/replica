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
  title: string | null
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
  title: string | null
  content: string | null
  /** The exact version a person edits or retires, so a stale page cannot overwrite it. */
  digest: string | null
  acceptedBy: string | null
  acceptedAt: string | null
  edited: boolean
  /** The decision the receipt records, which edits and reinstatements replace. */
  lastDecision: "accepted" | "edited" | "reinstated"
  status: "recalled" | "not-recalled" | "budget-excluded" | "damaged" | "identity-review"
}

/** A learning a person turned down or stopped using, kept so it can be reinstated. */
export interface RejectedLearning {
  id: string
  title: string | null
  content: string | null
  digest: string | null
  state: "rejected" | "retired"
  decidedBy: string | null
  decidedAt: string | null
  reason: string | null
}

/** One decision in a learning's history, oldest first. */
export interface LearningDecisionRecord {
  version: number
  state: "proposed" | "accepted" | "rejected" | "retired"
  change: "proposed" | "accepted" | "edited" | "reinstated" | "rejected" | "retired"
  by: string | null
  at: string | null
  reason: string | null
}

export type LearningDecision =
  | { decision: "accept"; digest: string; content?: string }
  | { decision: "reject"; digest: string; reason: string }
  | { decision: "retire"; reason: string }
  | { decision: "edit"; digest: string; title?: string; content?: string; reason: string }
  | { decision: "reinstate"; digest: string; reason: string }
