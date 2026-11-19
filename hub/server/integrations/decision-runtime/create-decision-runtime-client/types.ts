export interface DecisionRuntimeCredentialProvider {
  configurationDigest: string
  key: string
  getCredential(input: {
    audience: string
    operationId: string
    signal: AbortSignal
  }): Promise<{ token: string; expiresAt: Date }>
}

import type { DecisionRuntimeUsage } from "../../../utils/decision-runtime-usage/types.ts"
export type { DecisionRuntimeUsage } from "../../../utils/decision-runtime-usage/types.ts"

export interface DecisionRuntimeTasksetUpload {
  schemaVersion: "replica.decision-taskset-upload/v1"
  manifest: Record<string, unknown>
  tasks: Record<string, unknown>[]
  images: {
    path: string
    mediaType: string
    digest: string
    dataBase64: string
  }[]
}

export interface DecisionRuntimeJob {
  id: string
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  tasksetDigest: string
  candidateId?: string
  error?: { code: string }
  startedAt?: string
  completedAt?: string
  usage?: DecisionRuntimeUsage[]
}

export interface DecisionRuntimeCandidate {
  id: string
  tasksetDigest: string
  manifestDigest: string
  evaluationDigest: string
  productionEligible: boolean
  evidence: {
    baselineMeanReward: number | null
    candidateMeanReward: number | null
    meanRewardDelta: number | null
    baselineCalibrationError: number | null
    candidateCalibrationError: number | null
    calibrationErrorDelta: number | null
    learningMetrics: {
      learningId: string
      baselineBalancedAccuracy: number | null
      candidateBalancedAccuracy: number | null
      delta: number | null
      direction: "gain" | "regression" | "unchanged" | "unknown"
    }[]
  }
  usage?: DecisionRuntimeUsage[]
}

export interface DecisionRuntimePromotion {
  candidateId: string | null
  previousCandidateId?: string | null
  generation: number
}

export interface DecisionRuntimeDeletionSelectors {
  exportId?: string
  grantId?: string
  evidenceDigest?: string
  tasksetDigest?: string
}

export interface DecisionRuntimeCopy {
  id: string
  runtimeCopyId: string
  kind: string
  sourceTrainingExportId?: string
  permittingGrantIds?: string[]
  evidenceDigest?: string | null
  tasksetDigest?: string | null
  useState: string
  promotionState?: string | null
  storage: { connector: string; reference: string }
  retention: Record<string, unknown>
  createdAt?: string | null
}

export interface DecisionRuntimeDeletionReceipt {
  id: string
  state: "pending" | "completed"
  selectors: DecisionRuntimeDeletionSelectors
  items: {
    kind: string
    runtimeCopyId: string
    state: string
    storage?: { connector: string; reference: string }
    retention?: Record<string, unknown>
  }[]
  pendingItems: { kind: string; runtimeCopyId: string; code: string; retryable: boolean }[]
  failures: { kind: string; runtimeCopyId: string; code: string; retryable: boolean }[]
  revokedAt?: string
  completedAt?: string
  updatedAt: string
}

export interface DecisionRuntimeEvaluation {
  id?: string
  candidateId: string
  generation: number
  responseDigest: string
  evaluations: {
    learningId: string
    followsProbability: number
    breaksProbability: number
  }[]
  usage?: DecisionRuntimeUsage[]
}

export interface DecisionRuntimeClient {
  transferTaskset(input: {
    upload: DecisionRuntimeTasksetUpload
    tasksetDigest: string
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<{ reference: string; tasksetDigest: string }>
  submitTraining(input: {
    backend: string
    maxUpdates: number
    maxSeconds: number
    maxCredits: string
    tasksetDigest: string
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<DecisionRuntimeJob>
  getTrainingJob(id: string, signal?: AbortSignal): Promise<DecisionRuntimeJob>
  cancelTrainingJob(input: {
    id: string
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<DecisionRuntimeJob>
  getCandidate(id: string, signal?: AbortSignal): Promise<DecisionRuntimeCandidate>
  getPromotion(signal?: AbortSignal): Promise<DecisionRuntimePromotion>
  listRuntimeCopies?(input: {
    selectors: DecisionRuntimeDeletionSelectors
    cursor?: string
    limit?: number
    signal?: AbortSignal
  }): Promise<{ items: DecisionRuntimeCopy[]; nextCursor: string | null }>
  requestDeletion?(input: {
    selectors: DecisionRuntimeDeletionSelectors
    requestedBy: string
    reason: string
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<DecisionRuntimeDeletionReceipt>
  getDeletion?(id: string, signal?: AbortSignal): Promise<DecisionRuntimeDeletionReceipt>
  promote(input: {
    candidateId: string
    promotedBy: string
    expectedGeneration: number
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<DecisionRuntimePromotion>
  rollback(input: {
    rolledBackBy: string
    expectedGeneration: number
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<DecisionRuntimePromotion>
  evaluate(input: {
    state: Record<string, unknown>
    images: string[]
    questions: Record<string, unknown>
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<DecisionRuntimeEvaluation>
}
