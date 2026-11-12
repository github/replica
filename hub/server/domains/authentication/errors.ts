export class AuthenticationProofError extends Error {
  readonly code:
    "attempt_invalid" | "configuration_changed" | "provider_failed" | "verification_state_invalid"

  constructor(code: AuthenticationProofError["code"], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "AuthenticationProofError"
    this.code = code
  }
}

export class LocalSignInConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LocalSignInConfigurationError"
  }
}
