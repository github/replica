export type DecisionRuntimeFailureCode =
  | "authentication_failed"
  | "cancelled"
  | "conflict"
  | "deletion_revoked"
  | "invalid_response"
  | "not_found"
  | "rate_limited"
  | "runtime_failure"
  | "timeout"
  | "unavailable"

export class DecisionRuntimeError extends Error {
  readonly code: DecisionRuntimeFailureCode

  constructor(code: DecisionRuntimeFailureCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "DecisionRuntimeError"
    this.code = code
  }
}
