import type { LearningEvidence } from "../types.ts"

export interface LearningEvidenceReference {
  episodeId: string
  eventIds: string[]
  source: {
    kind?: string
    hubOrigin?: string
    repositoryId?: string
    prototypeId?: string
    threadId?: number
    commentId?: number
  }
}

export interface LearningObservationEvent {
  id: string
  episodeId: string
  at: string
  payload: {
    commentId: number
    body: string | null
  }
}

export interface ReviewCommentLearningSource {
  resolveEvidence(input: {
    repositoryId: string
    references: LearningEvidenceReference[]
    events: LearningObservationEvent[]
  }): Promise<Array<{ referenceIndex: number; evidence: LearningEvidence[] }>>
  captureCompleteSnapshot(input: { repositoryId: string }): Promise<{
    collection: unknown
    digest: `sha256:${string}`
    capturedAt: Date
  }>
}
