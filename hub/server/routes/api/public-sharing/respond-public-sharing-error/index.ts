import type { Response } from "express"

import { PublicSharingError } from "../../../../domains/public-sharing/errors.ts"
import { GitHubProviderRequestError } from "../../../../integrations/github/errors.ts"

const statuses: Record<PublicSharingError["code"], number> = {
  disabled: 403,
  forbidden: 403,
  invalid_expiration: 422,
  invalid_label: 422,
  not_found: 404,
  not_signed_in: 401,
  policy_changed: 409,
  state_changed: 409,
  unavailable_build: 404,
}

export function respondPublicSharingError(response: Response, error: unknown, hosted = false) {
  if (hosted && error instanceof GitHubProviderRequestError) {
    response.status(503).json({ error: "GitHub repository access could not be verified." })
    return true
  }
  if (!(error instanceof PublicSharingError)) return false
  if (hosted && error.code === "disabled") {
    response.status(403).json({
      code: "public_sharing_disabled",
      error: error.message,
      errors: [error.message],
    })
    return true
  }
  response.status(statuses[error.code]).json({ error: error.message })
  return true
}
