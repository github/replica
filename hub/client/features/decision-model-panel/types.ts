export interface DecisionTrainingJob {
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
  stateLabel: string
  createdAt: string
  finishedAt: string | null
  tasksetDigest: string
  failure: string | null
  failureKind: "retryable" | "terminal" | null
  cancelPath: string
  cancellable: boolean
}

export interface DecisionCandidate {
  id: string
  runtimeCandidateId: string
  createdAt: string
  productionEligible: boolean
  tasksetDigest: string
  baselineMeanReward: string
  candidateMeanReward: string
  meanRewardChange: string
  baselineCalibrationError: string
  candidateCalibrationError: string
  calibrationErrorChange: string
  learningMetrics: Array<{
    learningId: string
    baseline: string
    candidate: string
    change: string
    direction: "gain" | "regression" | "unchanged" | "unknown"
  }>
  duration: string
  usage: string[]
  rejection: { rejectedAt: string; reason: string | null } | null
  promoted: boolean
  promotePath: string
  rejectPath: string
}

export type DecisionModelPanelData =
  | {
      state: "repository-learning-only"
      message: string
    }
  | {
      state: "not-configured"
      message: string
      setupGuidance: string
    }
  | {
      state: "unavailable"
      message: string
      setupGuidance: string
    }
  | {
      state: "available"
      settingsPath: string
      trainingPath: string
      rollbackPath: string
      configuration: {
        enabled: boolean
        generation: number
        backend: string
        maxUpdates: number
        maxSeconds: number
        monthlyBudgetCredits: string
      } | null
      readiness: {
        runtime: string
        evidence: string
        latestTasksetDigest: string | null
        warnings: string[]
        blockedReasons: string[]
      }
      trainingAvailable: boolean
      preparationStatus?: string | null
      activeJob: DecisionTrainingJob | null
      jobs: DecisionTrainingJob[]
      candidates: DecisionCandidate[]
      promotion: {
        candidateId: string
        runtimeCandidateId: string
        generation: number
        operation: "promote" | "rollback"
        rollbackAvailable: boolean
      } | null
      evaluationBuilds: Array<{
        id: string
        number: number
        label: string
        evaluationPath: string
      }>
      evaluations: Array<{
        id: string
        buildNumber: number
        prototypePath: string
        runtimeCandidateId: string
        generation: number
        createdAt: string
        findingsAvailable: boolean
        findings: Array<{
          learningId: string
          learningText: string | null
          route: string
          views: string
          followsProbability: string
          breaksProbability: string
          explanation: string
        }>
      }>
      deletions: Array<{
        id: string
        state: "pending" | "completed" | "failed"
        summary: string
        failure: string | null
      }>
    }
