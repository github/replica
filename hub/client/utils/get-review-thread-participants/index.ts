import type { ReviewCommentAuthor } from "@utils/review-comment/types"

export function getReviewThreadParticipants(
  rootAuthor: ReviewCommentAuthor,
  replyAuthors: ReviewCommentAuthor[],
) {
  const participants = new Map<string, ReviewCommentAuthor>()
  participants.set(rootAuthor.login.toLowerCase(), rootAuthor)
  for (const author of replyAuthors.toReversed()) {
    const key = author.login.toLowerCase()
    if (!participants.has(key)) participants.set(key, author)
  }
  return Array.from(participants.values())
}
