import type { LearningEvidence } from "../../../routes/api/learnings/types.ts"

export interface LearningEvidenceReference {
  episodeId: string
  eventIds: string[]
  source: {
    kind?: string
    repositoryId?: string
    commentId?: number
  }
}

export interface ReviewCommentLearningSource {
  resolveEvidence(input: {
    repositoryId: string
    references: LearningEvidenceReference[]
  }): Promise<Array<{ referenceIndex: number; evidence: LearningEvidence[] }>>
  captureCompleteSnapshot(input: { repositoryId: string }): Promise<{
    collection: unknown
    digest: `sha256:${string}`
    capturedAt: Date
  }>
}
