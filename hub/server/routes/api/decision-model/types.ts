import type { CurrentSessionDependencies } from "../auth/types.ts"
import type {
  DecisionModelSettings,
  DecisionTrainingPreflight,
} from "../../../domains/decision-model/types.ts"
import type { DecisionRuntimeDeletionSelectors } from "../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"

export interface DecisionModelOverview {
  preflight: DecisionTrainingPreflight
  configuration: (DecisionModelSettings & { generation: number }) | null
  jobs: {
    id: string
    state:
      | "queued"
      | "submitting"
      | "cancel_requested"
      | "submitted"
      | "running"
      | "succeeded"
      | "failed"
      | "cancelled"
    tasksetDigest: string
    runtimeJobId: string | null
    candidateRuntimeId: string | null
    failureCode: string | null
    createdAt: string
    finishedAt: string | null
  }[]
  candidates: {
    id: string
    runtimeCandidateId: string
    backend: string
    tasksetDigest: string
    productionEligible: boolean
    baselineMeanReward: string | null
    candidateMeanReward: string | null
    meanRewardDelta: string | null
    baselineCalibrationError: string | null
    candidateCalibrationError: string | null
    calibrationErrorDelta: string | null
    learningMetrics: {
      learningId: string
      baselineBalancedAccuracy: number | null
      candidateBalancedAccuracy: number | null
      delta: number | null
      direction: "gain" | "regression" | "unchanged" | "unknown"
    }[]
    durationSeconds: number | null
    usage: {
      connector: string
      kind: string
      quantity: number
      unit: string
      cost: number | null
      currency: string | null
      source: string
      metadata: Record<string, unknown>
    }[]
    rejection: {
      rejectedAt: string
      reason: string | null
      membershipId: string | null
    } | null
    createdAt: string
  }[]
  promotion: {
    candidateId: string
    runtimeCandidateId: string
    generation: number
    operation: "promote" | "rollback"
    rollbackAvailable: boolean
  } | null
  promotionHistory: {
    candidateId: string
    runtimeCandidateId: string
    previousCandidateId: string | null
    previousRuntimeCandidateId: string | null
    generation: number
    operation: "promote" | "rollback"
    membershipId: string | null
    createdAt: string
  }[]
  evaluations: {
    id: string
    build: { id: string; number: number; prototypeId: string }
    model: { id: string; runtimeCandidateId: string; generation: number }
    questionDigest: string
    screenshotSetDigest: string
    responseDigest: string
    findingsAvailable: boolean
    findings: {
      learning: { id: string; text: string | null }
      route: string
      views: { viewport: string; theme: string }[]
      followsProbability: number
      breaksProbability: number
      explanation: string
    }[]
    createdAt: string
  }[]
  deletions: {
    id: string
    state: "pending" | "completed" | "failed"
    selectors: {
      exportId: string | null
      grantId: string | null
      evidenceDigest: string | null
      tasksetDigest: string | null
    }
    pending: number
    failures: number
    revokedAt: string | null
    completedAt: string | null
    failureCode: string | null
  }[]
}

export interface DecisionTrainingJobResponse {
  id: string
  state:
    | "queued"
    | "submitting"
    | "cancel_requested"
    | "submitted"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
  tasksetDigest: string
  runtimeJobId: string | null
  candidateRuntimeId: string | null
  failureCode: string | null
  createdAt: string
  finishedAt: string | null
}

export interface DecisionPromotionResponse {
  candidateId: string
  runtimeCandidateId: string
  previousCandidateId: string | null
  previousRuntimeCandidateId: string | null
  generation: number
}

export interface DecisionModelRouteDependencies {
  applicationOrigin: string
  currentSession: CurrentSessionDependencies
  getOverview(input: {
    repositoryId: string
    actorMembershipId: string
  }): Promise<DecisionModelOverview>
  saveSettings(input: {
    repositoryId: string
    actorMembershipId: string
    settings: DecisionModelSettings
  }): Promise<DecisionModelSettings & { generation: number }>
  requestTraining(input: {
    repositoryId: string
    actorMembershipId: string
    idempotencyKey: string
    expectedConfigurationGeneration: number
  }): Promise<{ created: boolean; job: DecisionTrainingJobResponse }>
  getTrainingJob(input: {
    repositoryId: string
    actorMembershipId: string
    jobId: string
  }): Promise<DecisionTrainingJobResponse>
  cancelTraining(input: {
    repositoryId: string
    actorMembershipId: string
    jobId: string
  }): Promise<DecisionTrainingJobResponse>
  rejectCandidate(input: {
    repositoryId: string
    actorMembershipId: string
    candidateId: string
    reason: string
  }): Promise<{ candidateId: string; rejectedAt: string }>
  promote(input: {
    repositoryId: string
    actorMembershipId: string
    actorLogin: string
    candidateId: string
    expectedGeneration: number
  }): Promise<DecisionPromotionResponse>
  rollback(input: {
    repositoryId: string
    actorMembershipId: string
    actorLogin: string
    expectedGeneration: number
  }): Promise<DecisionPromotionResponse>
  evaluateBuild(input: {
    repositoryId: string
    actorMembershipId: string
    buildId: string
  }): Promise<unknown>
  withdrawTrainingData(input: {
    repositoryId: string
    actorMembershipId: string
    actorLogin: string
    selectors: DecisionRuntimeDeletionSelectors
    reason: string
    idempotencyKey: string
  }): Promise<{
    id: string
    state: "pending" | "completed"
    pending: number
    failures: number
    completedAt: string | null
  }>
}
