import type { ReviewComment } from "@utils/review-comment/types"

export type ReviewCommentsFetchResult =
  { kind: "success"; comments: ReviewComment[] } | { kind: "access-lost" } | { kind: "failed" }
