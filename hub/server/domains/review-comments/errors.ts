export type ReviewCommentErrorCode =
  | "conflict"
  | "forbidden"
  | "invalid"
  | "mention_unavailable"
  | "not_found"
  | "unprocessable"
  | "unauthorized"
  | "unavailable"

export class ReviewCommentError extends Error {
  readonly code: ReviewCommentErrorCode

  constructor(code: ReviewCommentErrorCode, message: string) {
    super(message)
    this.name = "ReviewCommentError"
    this.code = code
  }
}
