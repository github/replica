export type LearningLifecycle = "suggested" | "active" | "rejected"

export interface LearningEvidence {
  id: string
  body: string | null
  authorLogin: string
  prototypeName: string
  buildNumber: number
  createdAt: string
  reviewPath: string
  stance: "supports" | "opposes"
}

export interface LearningRecord {
  id: string
  title: string
  guidance: string
  status: LearningLifecycle
  topic: string
  updatedAt: string
  acceptedBy?: string
  rejectionReason?: string
  evidence: LearningEvidence[]
}

export interface LearningActivityDay {
  date: string
  runState: "none" | "succeeded" | "failed"
  startedAt: string | null
  startedBy: string | null
  commentsAnalyzed: number
  commentsTagged: number
  suggestions: number
}

export interface LearningsLibraryPrototypeData {
  canDecide: boolean
  learnings: LearningRecord[]
  /** Daily summaries for days with a learning run; other past days show as "no run". */
  activity: LearningActivityDay[]
  /** UTC date treated as today; it picks the calendar year and which days are still ahead. */
  today: string
}
