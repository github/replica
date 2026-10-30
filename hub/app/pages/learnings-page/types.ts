import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"

/** A review comment behind a suggestion, from this repository's prototypes. */
export interface LearningEvidence {
  eventId: string
  commentId: number
  body: string | null
  authorLogin: string
  authorAvatarUrl: string | null
  prototypeName: string
  prototypePath: string
  createdAt: string
}

export interface LearningSuggestion {
  id: string
  content: string
  digest: string
  decisionPath: string
  support: string | null
  replaces: Array<{ id: string; content: string }>
  evidence: LearningEvidence[]
  otherEvidence: string | null
  contradictions: LearningEvidence[]
  otherContradictions: string | null
}

export interface AcceptedLearning {
  id: string
  content: string
  decisionPath: string
  accepted: string | null
  recalled: boolean
  status: string
}

export interface LearningRun {
  id: number
  startedAt: string
  startedBy: string
  state: "queued" | "running" | "succeeded" | "failed"
  stateLabel: string
  result: string | null
  usage: string
}

export interface LearningsPageData extends RepositoryWorkspaceData {
  pageTitle: string
  alert: string | null
  notice: string | null
  copy: Record<
    | "heading"
    | "description"
    | "runLabel"
    | "suggestionsHeading"
    | "suggestionsEmpty"
    | "evidenceHeading"
    | "contradictionsHeading"
    | "replacementHeading"
    | "deletedComment"
    | "accept"
    | "edit"
    | "contentLabel"
    | "acceptEdited"
    | "reject"
    | "rejectReason"
    | "confirmReject"
    | "cancel"
    | "acceptedHeading"
    | "acceptedEmpty"
    | "retire"
    | "retireReason"
    | "confirmRetire"
    | "recallHeading"
    | "recallDescription"
    | "recallEmpty"
    | "runsHeading"
    | "runsEmpty",
    string
  > & { runColumns: Record<"started" | "startedBy" | "result" | "usage", string> }
  status: { message: string; refused: boolean; activity: string | null; usage: string }
  run: { path: string; available: boolean }
  loadError: string | null
  identityNotice: string | null
  suggestions: LearningSuggestion[]
  learnings: AcceptedLearning[]
  recall: { text: string; count: number }
  runs: LearningRun[]
}
