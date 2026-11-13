export type SessionRevocationDenialReason =
  | "cancelled"
  | "expired"
  | "invalid_operation"
  | "not_authorized"
  | "session_mismatch"
  | "used"
  | "verification_required"

export class SessionRevocationDeniedError extends Error {
  readonly reason: SessionRevocationDenialReason

  constructor(reason: SessionRevocationDenialReason, options?: ErrorOptions) {
    super("Session revocation was denied.", options)
    this.name = "SessionRevocationDeniedError"
    this.reason = reason
  }
}

export class SessionRevocationTransactionConflictError extends Error {
  constructor(options?: ErrorOptions) {
    super("Session revocation conflicted with another database change.", options)
    this.name = "SessionRevocationTransactionConflictError"
  }
}

export class SessionRevocationPersistenceError extends Error {
  constructor(options?: ErrorOptions) {
    super("Session revocation could not be completed.", options)
    this.name = "SessionRevocationPersistenceError"
  }
}
