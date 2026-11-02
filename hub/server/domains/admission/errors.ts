export type AdmissionDenialReason =
  | "attempt_mismatch"
  | "configuration_changed"
  | "identity_mismatch"
  | "membership_inactive"
  | "membership_missing"
  | "provider_revoked"

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
