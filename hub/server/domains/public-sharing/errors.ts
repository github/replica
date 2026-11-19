export type PublicSharingErrorCode =
  | "disabled"
  | "forbidden"
  | "invalid_expiration"
  | "invalid_label"
  | "not_found"
  | "not_signed_in"
  | "policy_changed"
  | "state_changed"
  | "unavailable_build"

export class PublicSharingError extends Error {
  readonly code: PublicSharingErrorCode

  constructor(code: PublicSharingErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export class PublicSharingConfigurationError extends Error {}
