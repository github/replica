import type {
  DecisionRuntimeClient,
  DecisionRuntimeUsage,
} from "../../integrations/decision-runtime/create-decision-runtime-client/types.ts"

export interface DecisionModelSettings {
  enabled: boolean
  backend: string
  maxUpdates: number
  maxSeconds: number
  monthlyBudgetCredits: string
}

export interface PreparedDecisionTaskset {
  bytes: Uint8Array
  consentGrantId: string
  exportDigest: string
  repeatableReviewSnapshotDigest: string
  questionDigest: string
  buildSetDigest: string
  tasksetDigest: string
}

export interface PreparedBuildEvaluation {
  state: Record<string, unknown>
  images: string[]
  questions: Record<string, unknown>
  questionDigest: string
  screenshotSetDigest: string
}

export interface DecisionTrainingJobRecord {
  id: string
  repositoryId: string
  requestedByMembershipId: string | null
  idempotencyKey: string
  runtimeJobId: string | null
  runtimeTasksetId: string | null
  configurationGeneration: number
  state: "QUEUED" | "SUBMITTED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"
  backend: string
  maxUpdates: number
  maxSeconds: number
  budgetCredits: string
  consentGrantId: string
  exportDigest: string
  repeatableReviewSnapshotDigest: string
  questionDigest: string
  buildSetDigest: string
  tasksetDigest: string
  candidateRuntimeId: string | null
  createdAt: Date
}

export interface DecisionCandidateRecord {
  id: string
  repositoryId: string
  runtimeCandidateId: string
  tasksetDigest: string
}

export interface DecisionPromotionRecord {
  candidateId: string
  runtimeCandidateId: string
  previousCandidateId: string | null
  previousRuntimeCandidateId: string | null
  runtimeGeneration: number
}

export interface DecisionModelAuthorization {
  requireRepositoryAdministrator(input: {
    membershipId: string
    repositoryId: string
  }): Promise<void>
}

export interface DecisionModelStore {
  getConfiguration(repositoryId: string): Promise<
    | (DecisionModelSettings & {
        generation: number
      })
    | null
  >
  getMonthlyUsageCredits(repositoryId: string, since: Date): Promise<string>
  createOrGetJob(input: {
    repositoryId: string
    requestedByMembershipId: string
    idempotencyKey: string
    configurationGeneration: number
    settings: DecisionModelSettings
    taskset: PreparedDecisionTaskset
  }): Promise<{ created: boolean; job: DecisionTrainingJobRecord }>
  getJob(repositoryId: string, jobId: string): Promise<DecisionTrainingJobRecord | null>
  markJobSubmitted(input: {
    jobId: string
    runtimeJobId: string
    runtimeTasksetId: string
  }): Promise<DecisionTrainingJobRecord>
  updateJobState(input: {
    jobId: string
    state: DecisionTrainingJobRecord["state"]
    candidateRuntimeId?: string
    failureCode?: string
    usage?: DecisionRuntimeUsage
    audit?: {
      actorMembershipId: string
      outcome: "cancelled" | "failed"
      reason?: string
      repositoryId: string
    }
  }): Promise<DecisionTrainingJobRecord>
  completeJobWithCandidate(input: {
    repositoryId: string
    trainingJobId: string
    runtimeCandidateId: string
    tasksetDigest: string
    manifestDigest: string
    evaluationDigest: string
    productionEligible: boolean
    meanRewardDelta: number | null
    calibrationErrorDelta: number | null
    usage?: DecisionRuntimeUsage
    jobUsage?: DecisionRuntimeUsage
    actorMembershipId?: string
  }): Promise<{
    candidate: DecisionCandidateRecord | null
    job: DecisionTrainingJobRecord
  }>
  getCandidate(repositoryId: string, candidateId: string): Promise<DecisionCandidateRecord | null>
  getPromotion(repositoryId: string): Promise<DecisionPromotionRecord | null>
  savePromotion(input: {
    repositoryId: string
    candidateId: string
    previousCandidateId: string | null
    promotedByMembershipId: string
    runtimeGeneration: number
    operation: "PROMOTE" | "ROLLBACK"
  }): Promise<DecisionPromotionRecord>
  saveBuildEvaluation(input: {
    repositoryId: string
    buildId: string
    candidateId: string
    promotionGeneration: number
    questionDigest: string
    screenshotSetDigest: string
    runtimeEvaluationId?: string
    responseDigest: string
    summary: Record<string, unknown>
    usage?: DecisionRuntimeUsage
  }): Promise<{ id: string }>
}

export interface DecisionModelDependencies {
  authorization: DecisionModelAuthorization
  now(): Date
  prepareTaskset(input: {
    repositoryId: string
    actorMembershipId: string
  }): Promise<PreparedDecisionTaskset>
  prepareBuildEvaluation(input: {
    repositoryId: string
    buildId: string
  }): Promise<PreparedBuildEvaluation>
  runtime: DecisionRuntimeClient
  store: DecisionModelStore
}
