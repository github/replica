export type AdmissionDenialReason =
  | "authority_missing"
  | "attempt_mismatch"
  | "configuration_changed"
  | "identity_mismatch"
  | "membership_inactive"
  | "membership_missing"
  | "provider_evidence_missing"
  | "provider_evidence_stale"
  | "no_repository_access"

export class AdmissionDeniedError extends Error {
  readonly reason: AdmissionDenialReason
  readonly externalIdentityId: string

  constructor(reason: AdmissionDenialReason, externalIdentityId: string, options?: ErrorOptions) {
    super("Hub admission was denied.", options)
    this.name = "AdmissionDeniedError"
    this.reason = reason
    this.externalIdentityId = externalIdentityId
  }
}

export class AdmissionTransactionConflictError extends Error {
  constructor(options?: ErrorOptions) {
    super("The admission transaction conflicted with another database change.", options)
    this.name = "AdmissionTransactionConflictError"
  }
}

export class AdmissionPersistenceError extends Error {
  constructor(options?: ErrorOptions) {
    super("Hub admission could not be completed.", options)
    this.name = "AdmissionPersistenceError"
  }
}
