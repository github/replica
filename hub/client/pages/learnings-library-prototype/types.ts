export type LearningLifecycle = "suggested" | "active" | "rejected"

export interface LearningEvidence {
  id: string
  body: string | null
  authorLogin: string
  prototypeName: string
  buildNumber: number
  createdAt: string
  reviewPath: string
}

export interface LearningOutcome {
  id: string
  prototypeName: string
  buildNumber: number
  buildPath: string
  result: "supports" | "concern" | "inconclusive"
  source: "automated" | "reviewer-confirmed"
  summary: string
  evaluatedAt: string
  beforeScreenshotUrl?: string
  afterScreenshotUrl?: string
}

export interface LearningOutcomeAssessment {
  version: number
  status: "not-evaluated" | "insufficient-evidence" | "observed"
  outcomes: LearningOutcome[]
}

export interface LearningUpdateSuggestion {
  title: string
  guidance: string
  reason: string
}

export interface LearningDecision {
  status: "active" | "rejected"
  decidedAt: string
  reason?: string
}

export interface LearningVersion {
  version: number
  title: string
  guidance: string
  updatedAt: string
  outcomeAssessment?: LearningOutcomeAssessment
}

export interface LearningRecord {
  id: string
  title: string
  guidance: string
  status: LearningLifecycle
  topic: string
  updatedAt: string
  version?: number
  acceptedBy?: string
  rejectionReason?: string
  decisions?: LearningDecision[]
  updateSuggestion?: LearningUpdateSuggestion
  outcomeAssessment?: LearningOutcomeAssessment
  versionHistory?: LearningVersion[]
  /** One live copy that every Hub repository can use as read-only guidance. */
  sharedAcrossHub?: boolean
  /** The source repository for a read-only copy shared with this repository. */
  sharedFrom?: { repositoryName: string }
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
  /**
   * Daily summaries for days with a learning run. Other past days show as "no run".
   */
  activity: LearningActivityDay[]
  /**
   * UTC date treated as today. It picks the calendar year and which days are still
   * ahead.
   */
  today: string
  /** Hub's agent setup page, when MCP connection guidance is available to members. */
  agentConnectionPath?: string
  /** Shown only to Hub admins, who manage the shared evaluation budget. */
  evaluationSettingsPath?: string
  /** Hub admins can share learnings with every repository and manage evaluations. */
  isHubAdmin?: boolean
  /** Number of repositories connected to Hub. */
  hubRepositoryCount?: number
  /** Explains when a learning was removed because its source stopped sharing it. */
  sharedLearningNotice?: string
}
