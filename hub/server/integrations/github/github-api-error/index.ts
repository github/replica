export class GitHubApiError extends Error {
  constructor(readonly status: number) {
    super("GitHub API request failed.")
  }
}
