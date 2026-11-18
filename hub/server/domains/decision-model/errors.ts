export type DecisionModelErrorCode =
  | "access_denied"
  | "budget_exceeded"
  | "build_not_found"
  | "candidate_not_found"
  | "candidate_already_promoted"
  | "candidate_rejected"
  | "configuration_disabled"
  | "configuration_stale"
  | "control_busy"
  | "deletion_revoked"
  | "consent_required"
  | "job_not_found"
  | "invalid_request"
  | "promotion_stale"
  | "repository_not_found"
  | "rollback_unavailable"
  | "runtime_unavailable"
  | "taskset_drift"

export class DecisionModelError extends Error {
  readonly status: number
  readonly code: DecisionModelErrorCode

  constructor(
    status: number,
    code: DecisionModelErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "DecisionModelError"
    this.status = status
    this.code = code
  }
}
