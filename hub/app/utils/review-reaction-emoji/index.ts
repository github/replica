import type { ReviewReactionContent } from "@utils/review-comment/types"

const EMOJI: Record<ReviewReactionContent, string> = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
}

export function reviewReactionEmoji(content: ReviewReactionContent): string {
  return EMOJI[content]
}
