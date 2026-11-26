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
