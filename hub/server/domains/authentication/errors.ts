export class AuthenticationProofError extends Error {
  readonly code: "attempt_invalid" | "configuration_changed" | "provider_failed" | "rate_limited"

  constructor(code: AuthenticationProofError["code"], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "AuthenticationProofError"
    this.code = code
  }
}
