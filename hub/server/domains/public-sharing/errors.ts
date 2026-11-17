export type PublicSharingErrorCode =
  | "disabled"
  | "invalid_expiration"
  | "invalid_label"
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
