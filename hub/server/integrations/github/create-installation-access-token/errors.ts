export class CopilotCredentialError extends Error {
  readonly code: "installation_revoked" | "permission_denied" | "unavailable"

  constructor(code: CopilotCredentialError["code"], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CopilotCredentialError"
    this.code = code
  }
}
