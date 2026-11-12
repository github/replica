export type AdministratorManagementDenialReason =
  "invalid_selection" | "invalid_target" | "last_administrator" | "not_authorized" | "role_changed"

export class AdministratorManagementDeniedError extends Error {
  readonly reason: AdministratorManagementDenialReason

  constructor(reason: AdministratorManagementDenialReason, options?: ErrorOptions) {
    super("Administrator management was denied.", options)
    this.name = "AdministratorManagementDeniedError"
    this.reason = reason
  }
}

export class AdministratorManagementTransactionConflictError extends Error {
  constructor(options?: ErrorOptions) {
    super("Administrator management conflicted with another database change.", options)
    this.name = "AdministratorManagementTransactionConflictError"
  }
}

export class AdministratorManagementPersistenceError extends Error {
  constructor(options?: ErrorOptions) {
    super("Administrator management could not be completed.", options)
    this.name = "AdministratorManagementPersistenceError"
  }
}
