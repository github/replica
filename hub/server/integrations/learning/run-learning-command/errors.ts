export class LearningCommandError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "LearningCommandError"
    this.code = code
  }
}
