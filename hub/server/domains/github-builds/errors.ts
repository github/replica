export class GitHubBuildAuthorTargetError extends Error {
  constructor() {
    super("No GitHub Build matches that repository and Build ID.")
    this.name = "GitHubBuildAuthorTargetError"
  }
}
