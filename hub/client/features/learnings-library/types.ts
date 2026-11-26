import type { LearningActivityDay } from "@features/learning-activity-grid/types"

/** A review comment behind a learning, from this repository's prototypes. */
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

export type LearningStatus = "suggested" | "active" | "rejected"

/** One row in the library list. */
export interface LibraryLearning {
  id: string
  status: LearningStatus
  title: string
  guidance: string
  /** When someone last decided on it. Suggestions have no decision yet. */
  updatedAt: string | null
  /** The repository that shared it, when it comes from another repository. */
  source: string | null
  detailPath: string
}

/** One decision in a learning's history, oldest first. */
export interface LearningHistoryEntry {
  label: string
  at: string | null
  by: string | null
  reason: string | null
}

/** How one later Build did with a learning's guidance. */
export interface LearningOutcome {
  id: string
  result: "supports" | "concern" | "inconclusive"
  /** True when the person who gave the feedback confirmed the change worked. */
  reviewerConfirmed: boolean
  summary: string
  buildLabel: string
  buildPath: string
  evaluatedAt: string
  beforeScreenshotUrl: string | null
  afterScreenshotUrl: string | null
}

/** New wording Copilot suggested because later Builds kept showing the same issue. */
export interface LearningUpdate {
  id: string
  issue: string
  /** A new title, or null when the suggestion keeps the current one. */
  title: string | null
  content: string
  reasoning: string
  /** The scored Builds that showed the issue and that Hub can still show. */
  support: Array<{ label: string; path: string }>
}

/** Wording agents were given before the current version, with how it was scored. */
export interface EarlierGuidance {
  version: number
  title: string | null
  guidance: string
  outcomes: LearningOutcome[]
}

/** Everything the detail view shows for the selected learning. */
export interface LearningDetail {
  id: string
  status: LearningStatus
  title: string
  guidance: string
  /** Short facts such as who accepted it and whether agents get it. */
  facts: string[]
  reason: { heading: string; text: string } | null
  replaces: Array<{ id: string; content: string }>
  evidence: LearningEvidence[]
  otherEvidence: string | null
  contradictions: LearningEvidence[]
  otherContradictions: string | null
  history: LearningHistoryEntry[]
  /** How later Builds did with the current wording. Null when agents don't get it. */
  outcomes: LearningOutcome[] | null
  /** Suggested new wording for an active learning. */
  updates: LearningUpdate[]
  /** True when the last check found too few scored Builds to suggest new wording. */
  updateNeedsMoreEvidence: boolean
  /** Wording agents were given before, newest first. */
  earlierGuidance: EarlierGuidance[]
  /**
   * Present only when the viewer can decide and the stored version is intact. The
   * title and content are the stored wording, which the edit form starts from.
   */
  decision: { path: string; digest: string; title: string; content: string } | null
  /** The repository that shared it, when it comes from another repository. */
  source: string | null
  /** Present only when the viewer can share this learning or stop sharing it. */
  share: { path: string; shared: boolean } | null
}

export interface LearningsLibraryData {
  /** Days with a learning run this UTC year. Other past days had no run. */
  activity: LearningActivityDay[]
  /** UTC date treated as today, which picks the activity grid's year. */
  today: string
  status: LearningStatus
  counts: Record<LearningStatus, number>
  statusPaths: Record<LearningStatus, string>
  query: string
  /** The list address for the current status and search, without a page number. */
  listPath: string
  /** The list page the viewer came from, for the detail view's back link. */
  returnPath: string
  page: number
  pageCount: number
  learnings: LibraryLearning[]
  selected: LearningDetail | null
}
