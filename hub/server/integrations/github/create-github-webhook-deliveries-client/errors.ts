import { GitHubProviderRequestError } from "../errors.ts"

export class GitHubWebhookRequestError extends GitHubProviderRequestError {
  readonly operation: string
  readonly failure: "http" | "transport" | "response"
  readonly statusCode: number | undefined

  constructor(operation: string, failure: "http" | "transport" | "response", statusCode?: number) {
    super()
    this.operation = operation
    this.failure = failure
    this.statusCode = statusCode
    this.name = "GitHubWebhookRequestError"
    this.message = `GitHub webhook ${operation} failed (${failure}${statusCode ? `, HTTP ${statusCode}` : ""}).`
  }
}
