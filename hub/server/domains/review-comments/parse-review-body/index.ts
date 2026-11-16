import { ReviewCommentError } from "../errors.ts"

const maximumBytes = 10_000

export function parseReviewBody(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new ReviewCommentError(
      "invalid",
      `Review comment text must be nonblank and ${maximumBytes} UTF-8 bytes or fewer.`,
    )
  }
  return value
}
