export class CopilotTokenCheckError extends Error {
  readonly reason: "refused" | "unavailable"

  constructor(reason: "refused" | "unavailable", options?: ErrorOptions) {
    super(
      reason === "refused"
        ? "Copilot refused the configured token."
        : "Copilot could not check the configured token.",
      options,
    )
    this.name = "CopilotTokenCheckError"
    this.reason = reason
  }
}
