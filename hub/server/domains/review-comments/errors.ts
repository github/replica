export type ReviewCommentErrorCode =
  "conflict" | "forbidden" | "invalid" | "not_found" | "unprocessable"

export class ReviewCommentError extends Error {
  readonly code: ReviewCommentErrorCode

  constructor(code: ReviewCommentErrorCode, message: string) {
    super(message)
    this.name = "ReviewCommentError"
    this.code = code
  }
}
