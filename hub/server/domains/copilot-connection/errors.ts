export class CopilotConnectionError extends Error {
  readonly code:
    | "busy"
    | "connection_changed"
    | "credential_missing"
    | "credential_permission_denied"
    | "credential_refused"
    | "credential_revoked"
    | "not_authorized"
    | "not_connected"
    | "unavailable"

  constructor(code: CopilotConnectionError["code"], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CopilotConnectionError"
    this.code = code
  }
}
