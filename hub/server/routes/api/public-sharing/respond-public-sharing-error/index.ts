import type { Response } from "express"

import { PublicSharingError } from "../../../../domains/public-sharing/errors.ts"

export function respondPublicSharingError(response: Response, error: unknown) {
  if (!(error instanceof PublicSharingError)) return false
  const status =
    error.code === "disabled"
      ? 403
      : error.code === "unavailable_build"
        ? 404
        : error.code === "policy_changed" || error.code === "state_changed"
          ? 409
          : 422
  response.status(status).json({ error: error.message })
  return true
}
