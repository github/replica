import { REVIEW_COMMENTS_SCHEMA } from "@utils/review-comment/schemas"
import { reviewAccessUnavailable } from "../review-access-unavailable"
import type { ReviewCommentsFetchResult } from "./types"

/** Fetches the complete comment collection. */
export async function fetchAllReviewComments(
  path: string,
  signal: AbortSignal,
): Promise<ReviewCommentsFetchResult> {
  try {
    const response = await fetch(new URL(path, window.location.origin), {
      headers: { Accept: "application/json" },
      signal,
    })
    if (reviewAccessUnavailable(response)) return { kind: "access-lost" }
    if (!response.ok) return { kind: "failed" }
    const collection = REVIEW_COMMENTS_SCHEMA.safeParse(await response.json())
    if (!collection.success) return { kind: "failed" }

    return { kind: "success", comments: collection.data.comments }
  } catch (error) {
    if (signal.aborted) throw error

    return { kind: "failed" }
  }
}
