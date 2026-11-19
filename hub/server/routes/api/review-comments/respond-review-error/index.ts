import type { Response } from "express"

import { ReviewCommentError } from "../../../../domains/review-comments/errors.ts"

export function respondReviewError(error: unknown, response: Response): boolean {
  if (!(error instanceof ReviewCommentError)) return false
  const status = {
    invalid: 422,
    mention_unavailable: 503,
    forbidden: 403,
    conflict: 409,
    not_found: 404,
    unauthorized: 401,
    unavailable: 503,
    unprocessable: 422,
  }[error.code]
  response.status(status).json({
    error: error.message,
    ...(error.code === "mention_unavailable" ? { code: error.code } : {}),
  })
  return true
}
