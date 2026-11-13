export class LearningsError extends Error {
  readonly code: string
  readonly status: number

  constructor(status: number, code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "LearningsError"
    this.code = code
    this.status = status
  }
}
