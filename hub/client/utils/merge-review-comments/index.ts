import type { ReviewComment } from "@utils/review-comment/types"

export function mergeReviewComments(loaded: ReviewComment[], current: ReviewComment[]) {
  const comments = new Map<number, ReviewComment>()
  for (const comment of current) comments.set(comment.id, comment)
  for (const comment of loaded) comments.set(comment.id, comment)
  return Array.from(comments.values()).sort(
    (first, second) =>
      Date.parse(second.createdAt) - Date.parse(first.createdAt) || second.id - first.id,
  )
}
