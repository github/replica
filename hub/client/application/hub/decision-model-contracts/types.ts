export interface DecisionModelConfigurationResponse {
  enabled: boolean
  generation: number
  backend: string
  maxUpdates: number
  maxSeconds: number
  monthlyBudgetCredits: string
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

export interface DecisionCandidateResponse {
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
  learningMetrics: Array<{
    learningId: string
    baselineBalancedAccuracy: number | null
    candidateBalancedAccuracy: number | null
    delta: number | null
    direction: "gain" | "regression" | "unchanged" | "unknown"
  }>
  durationSeconds: number | null
  usage: Array<{
    connector: string
    kind: string
    quantity: number
    unit: string
    cost: number | null
    currency: string | null
    source: string
    metadata: Record<string, unknown>
  }>
  rejection: {
    rejectedAt: string
    reason: string | null
    membershipId: string | null
  } | null
  createdAt: string
}

export interface DecisionPromotionResponse {
  candidateId: string
  runtimeCandidateId: string
  generation: number
  operation: "promote" | "rollback"
  rollbackAvailable: boolean
}

export interface DecisionModelOverviewResponse {
  preflight: {
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
    warnings: Array<{ code: string; message: string; count?: number }>
    reasons: Array<{ code: string; count: number }>
    digests: {
      export: string | null
      reviewSnapshot: string
      buildSet: string
      questionSet: string | null
      taskset: string | null
    }
  }
  configuration: DecisionModelConfigurationResponse | null
  jobs: DecisionTrainingJobResponse[]
  candidates: DecisionCandidateResponse[]
  promotion: DecisionPromotionResponse | null
  promotionHistory: Array<{
    candidateId: string
    runtimeCandidateId: string
    previousCandidateId: string | null
    previousRuntimeCandidateId: string | null
    generation: number
    operation: "promote" | "rollback"
    membershipId: string | null
    createdAt: string
  }>
  evaluationBuilds: Array<{
    id: string
    number: number
    prototype: { id: string; name: string | null; branchName: string }
  }>
  evaluations: Array<{
    id: string
    build: { id: string; number: number; prototypeId: string }
    model: { id: string; runtimeCandidateId: string; generation: number }
    questionDigest: string
    screenshotSetDigest: string
    responseDigest: string
    findingsAvailable: boolean
    findings: Array<{
      learning: { id: string; text: string | null }
      route: string
      views: Array<{ viewport: string; theme: string }>
      followsProbability: number
      breaksProbability: number
      explanation: string
    }>
    createdAt: string
  }>
  deletions: Array<{
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
  }>
}

export type DecisionModelAvailability =
  | { state: "available"; overview: DecisionModelOverviewResponse }
  | { state: "not-configured" }
  | { state: "unavailable"; error: string }

export interface DecisionTrainingRequestResponse {
  created: boolean
  job: {
    id: string
    state: DecisionTrainingJobResponse["state"]
    runtimeJobId: string | null
    candidateRuntimeId: string | null
    failureCode: string | null
    createdAt: string
  }
}

export interface DecisionTrainingMutationResponse {
  id: string
  state: DecisionTrainingJobResponse["state"]
}

export interface DecisionPromotionMutationResponse {
  candidateId: string
  runtimeCandidateId: string
  previousCandidateId: string | null
  previousRuntimeCandidateId: string | null
  generation: number
}

export interface DecisionCandidateRejectionMutationResponse {
  candidateId: string
  rejectedAt: string
}
