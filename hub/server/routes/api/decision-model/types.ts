import type { CurrentSessionDependencies } from "../auth/types.ts"
import type { DecisionModelSettings } from "../../../domains/decision-model/types.ts"

export interface DecisionModelOverview {
  preflight: {
    counts: {
      prototypes: number
      builds: number
      screenshots: number
      questions: number
      samples: number
    }
    warnings: { code: string; message: string; count?: number }[]
  }
  configuration: (DecisionModelSettings & { generation: number }) | null
  jobs: {
    id: string
    state: "queued" | "submitted" | "running" | "succeeded" | "failed" | "cancelled"
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
    findings: {
      learning: { id: string; text: string | null }
      route: string
      views: { viewport: string; theme: string }[]
      followsProbability: number
      breaksProbability: number
    }[]
    createdAt: string
  }[]
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
  }): Promise<unknown>
  getTrainingJob(input: {
    repositoryId: string
    actorMembershipId: string
    jobId: string
  }): Promise<unknown>
  cancelTraining(input: {
    repositoryId: string
    actorMembershipId: string
    jobId: string
  }): Promise<unknown>
  rejectCandidate(input: {
    repositoryId: string
    actorMembershipId: string
    candidateId: string
    reason: string
  }): Promise<unknown>
  promote(input: {
    repositoryId: string
    actorMembershipId: string
    actorLogin: string
    candidateId: string
    expectedGeneration: number
  }): Promise<unknown>
  rollback(input: {
    repositoryId: string
    actorMembershipId: string
    actorLogin: string
    expectedGeneration: number
  }): Promise<unknown>
  evaluateBuild(input: {
    repositoryId: string
    actorMembershipId: string
    buildId: string
  }): Promise<unknown>
}
