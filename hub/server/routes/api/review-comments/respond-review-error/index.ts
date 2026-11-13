import type { Response } from "express"

import { ReviewCommentError } from "../../../../domains/review-comments/errors.ts"

export function respondReviewError(error: unknown, response: Response): boolean {
  if (!(error instanceof ReviewCommentError)) return false
  const status = {
    invalid: 422,
    forbidden: 403,
    conflict: 409,
    not_found: 404,
    unprocessable: 422,
  }[error.code]
  response
    .status(status)
    .json(error.code === "unprocessable" ? { errors: [error.message] } : { error: error.message })
  return true
}
