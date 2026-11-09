export type AdministratorAuthorizationReason =
  | "cancelled"
  | "expired"
  | "identity_mismatch"
  | "invalid_operation"
  | "not_authorized"
  | "session_mismatch"
  | "used"
  | "verification_required"

export class AdministratorAuthorizationDeniedError extends Error {
  readonly reason: AdministratorAuthorizationReason

  constructor(reason: AdministratorAuthorizationReason, options?: ErrorOptions) {
    super("The administrator authorization cannot be used.", options)
    this.name = "AdministratorAuthorizationDeniedError"
    this.reason = reason
  }
}
