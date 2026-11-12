export class CopilotConnectionError extends Error {
  readonly code:
    | "busy"
    | "connection_changed"
    | "not_authorized"
    | "not_connected"
    | "token_missing"
    | "token_refused"
    | "unavailable"

  constructor(code: CopilotConnectionError["code"], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CopilotConnectionError"
    this.code = code
  }
}
