export class GitHubProviderRequestError extends Error {
  constructor(options?: ErrorOptions) {
    super("GitHub authentication request failed.", options)
    this.name = "GitHubProviderRequestError"
  }
}
