import type {
  DecisionRuntimeCandidate,
  DecisionRuntimeClient,
  DecisionRuntimeTasksetUpload,
  DecisionRuntimeCopy,
  DecisionRuntimeDeletionReceipt,
  DecisionRuntimeDeletionSelectors,
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
  upload: DecisionRuntimeTasksetUpload
  consentGrantId: string
  trainingExportId: string
  evidenceDigest: string
  exportDigest: string
  repeatableReviewSnapshotDigest: string
  questionDigest: string
  buildSetDigest: string
  tasksetDigest: string
}

export interface DecisionTrainingPreflight {
  state: "ready" | "blocked"
  counts: {
    prototypes: number
    builds: number
    pages: number
    screenshots: number
    questions: number
    samples: number
    tasks: number
    train: number
    dev: number
    test: number
    follows: number
    breaks: number
  }
  warnings: {
    code: string
    message: string
    count?: number
  }[]
  reasons: { code: string; count: number }[]
  digests: {
    export: string | null
    reviewSnapshot: string
    buildSet: string
    questionSet: string | null
    taskset: string | null
  }
}

export interface PreparedBuildEvaluation {
  state: Record<string, unknown>
  images: string[]
  questions: Record<string, unknown>
  route: string
  views: {
    viewport: string
    theme: string
  }[]
  questionDigest: string
  screenshotSetDigest: string
}

export interface DecisionBuildEvaluationFinding {
  learning: {
    id: string
  }
  route: string
  views: {
    viewport: string
    theme: string
  }[]
  followsProbability: number
  breaksProbability: number
  explanation: string
}

export interface DecisionTrainingJobRecord {
  id: string
  repositoryId: string
  requestedByMembershipId: string | null
  idempotencyKey: string
  runtimeJobId: string | null
  runtimeTasksetId: string | null
  configurationGeneration: number
  state:
    | "QUEUED"
    | "SUBMITTING"
    | "CANCEL_REQUESTED"
    | "SUBMITTED"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED"
  backend: string
  maxUpdates: number
  maxSeconds: number
  budgetCredits: string
  consentGrantId: string
  trainingExportId: string
  evidenceDigest: string
  exportDigest: string
  repeatableReviewSnapshotDigest: string
  questionDigest: string
  buildSetDigest: string
  tasksetDigest: string
  candidateRuntimeId: string | null
  failureCode: string | null
  createdAt: Date
}

export interface DecisionCandidateRecord {
  id: string
  repositoryId: string
  runtimeCandidateId: string
  tasksetDigest: string
  rejectedAt: Date | null
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
  getJobByIdempotencyKey?(
    repositoryId: string,
    idempotencyKey: string,
  ): Promise<DecisionTrainingJobRecord | null>
  markJobSubmitted(input: {
    jobId: string
    runtimeJobId: string
    runtimeTasksetId: string
  }): Promise<DecisionTrainingJobRecord>
  markJobSubmitting(jobId: string): Promise<DecisionTrainingJobRecord>
  requestCancellation(input: {
    jobId: string
    actorMembershipId: string
    repositoryId: string
  }): Promise<{
    terminal: boolean
    job: DecisionTrainingJobRecord
  }>
  completeAdministratorCancellation(input: {
    jobId: string
    actorMembershipId: string
    repositoryId: string
    state: "FAILED" | "CANCELLED"
    failureCode?: string
    usage?: DecisionRuntimeUsage[]
  }): Promise<DecisionTrainingJobRecord>
  updateJobState(input: {
    jobId: string
    state: DecisionTrainingJobRecord["state"]
    candidateRuntimeId?: string
    failureCode?: string
    usage?: DecisionRuntimeUsage[]
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
    baselineMeanReward: number | null
    candidateMeanReward: number | null
    meanRewardDelta: number | null
    baselineCalibrationError: number | null
    candidateCalibrationError: number | null
    calibrationErrorDelta: number | null
    learningMetrics: DecisionRuntimeCandidate["evidence"]["learningMetrics"]
    durationSeconds?: number
    usage?: DecisionRuntimeUsage[]
    jobUsage?: DecisionRuntimeUsage[]
    actorMembershipId?: string
  }): Promise<{
    candidate: DecisionCandidateRecord | null
    job: DecisionTrainingJobRecord
  }>
  getCandidate(repositoryId: string, candidateId: string): Promise<DecisionCandidateRecord | null>
  rejectCandidate(input: {
    repositoryId: string
    candidateId: string
    rejectedByMembershipId: string
    reason: string
  }): Promise<DecisionCandidateRecord>
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
    actorMembershipId: string
    promotionGeneration: number
    questionDigest: string
    screenshotSetDigest: string
    runtimeEvaluationId?: string
    responseDigest: string
    summary: {
      findings: DecisionBuildEvaluationFinding[]
    }
    usage?: DecisionRuntimeUsage[]
  }): Promise<{ id: string }>
  isTasksetRevoked?(input: {
    repositoryId: string
    exportId: string
    grantId: string
    evidenceDigest: string
    tasksetDigest: string
  }): Promise<boolean>
  isCandidateRevoked?(repositoryId: string, candidateId: string): Promise<boolean>
  createOrGetDeletion?(input: {
    repositoryId: string
    requestedByMembershipId: string
    idempotencyKey: string
    selectors: DecisionRuntimeDeletionSelectors
    reason: string
  }): Promise<{ id: string; runtimeDeletionId: string | null; state: string }>
  saveRuntimeCopies?(repositoryId: string, copies: DecisionRuntimeCopy[]): Promise<void>
  updateDeletionReceipt?(deletionId: string, receipt: DecisionRuntimeDeletionReceipt): Promise<void>
  getDeletion?(id: string): Promise<{
    id: string
    repositoryId: string
    runtimeDeletionId: string | null
    state: "PENDING" | "COMPLETED" | "FAILED"
  } | null>
  listPendingDeletions?(): Promise<
    { id: string; repositoryId: string; runtimeDeletionId: string | null }[]
  >
}

export interface DecisionModelDependencies {
  authorization: DecisionModelAuthorization
  now(): Date
  prepareTaskset(input: {
    repositoryId: string
    actorMembershipId: string
  }): Promise<PreparedDecisionTaskset>
  preflightTaskset(input: {
    repositoryId: string
    actorMembershipId: string
  }): Promise<DecisionTrainingPreflight>
  hasTrainingConsent(input: {
    repositoryId: string
    actorMembershipId: string
    consentGrantId: string
  }): Promise<boolean>
  prepareBuildEvaluation(input: {
    repositoryId: string
    buildId: string
    actorMembershipId: string
  }): Promise<PreparedBuildEvaluation>
  runtime?: DecisionRuntimeClient
  runtimeForRepository?: (repositoryId: string) => DecisionRuntimeClient
  store: DecisionModelStore
  withControlLock<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>
  listTrainingWithdrawals?(): Promise<
    {
      repositoryId: string
      actorMembershipId: string
      actorLogin: string
      selectors: DecisionRuntimeDeletionSelectors
      reason: string
      idempotencyKey: string
    }[]
  >
}
