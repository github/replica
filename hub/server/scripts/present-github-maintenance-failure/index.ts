import { GitHubBuildAuthorTargetError } from "../../domains/github-builds/errors.ts"
import { GitHubWebhookRequestError } from "../../integrations/github/create-github-webhook-deliveries-client/errors.ts"
import { GitHubCommitLookupError } from "../../integrations/github/errors.ts"
import { GitHubMaintenanceInputError } from "../github-maintenance-errors.ts"

export function presentGitHubMaintenanceFailure(error: unknown): string {
  if (
    error instanceof GitHubMaintenanceInputError ||
    error instanceof GitHubBuildAuthorTargetError
  ) {
    return error.message
  }
  if (error instanceof GitHubCommitLookupError) {
    return `GitHub commit lookup failed (HTTP ${error.statusCode}).`
  }
  if (error instanceof GitHubWebhookRequestError) {
    const status =
      error.statusCode && Number.isInteger(error.statusCode) && error.statusCode <= 599
        ? `, HTTP ${error.statusCode}`
        : ""
    return `GitHub webhook request failed (${error.failure}${status}).`
  }
  return "GitHub maintenance failed; check the scoped IDs, App configuration, and database access."
}
