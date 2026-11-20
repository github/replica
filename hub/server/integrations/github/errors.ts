export class GitHubProviderRequestError extends Error {
  constructor(options?: ErrorOptions) {
    super("GitHub authentication request failed.", options)
    this.name = "GitHubProviderRequestError"
  }
}

export class GitHubCommitLookupError extends GitHubProviderRequestError {
  readonly statusCode: number

  constructor(status: number) {
    super()
    this.name = "GitHubCommitLookupError"
    this.message = `GitHub commit lookup failed (HTTP ${status}).`
    this.statusCode = status
  }
}
