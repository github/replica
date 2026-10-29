import type { GitHubErrorCode } from "#server/integrations/github/github-error/types"

export class GitHubError extends Error {
  code: GitHubErrorCode

  constructor(code: GitHubErrorCode, message: string) {
    super(message)
    this.code = code
  }
}
