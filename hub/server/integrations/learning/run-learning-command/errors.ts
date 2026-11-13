export class LearningCommandError extends Error {
  readonly code: string
  readonly result: unknown

  constructor(code: string, message: string, options?: ErrorOptions & { result?: unknown }) {
    super(message, options)
    this.name = "LearningCommandError"
    this.code = code
    this.result = options?.result
  }
}
