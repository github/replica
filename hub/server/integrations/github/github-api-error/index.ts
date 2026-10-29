export class GitHubApiError extends Error {
  readonly status: number

  constructor(status: number) {
    super("GitHub API request failed.")
    this.status = status
  }
}
