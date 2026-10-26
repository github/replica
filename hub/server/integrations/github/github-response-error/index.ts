import { IdentityError } from "#server/utils/identity-error"

export class GitHubResponseError extends IdentityError {
  upstreamStatus: number

  constructor(upstreamStatus: number) {
    super(
      503,
      "github_unavailable",
      "GitHub could not verify identity or repository access. Try again.",
    )
    this.upstreamStatus = upstreamStatus
  }
}
