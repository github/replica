import type { CollaborationThread } from "../../../repositories/review-comments/collaboration-queries/index.ts"
import { githubReviewId } from "../create-review-mention-directory/index.ts"
import { serializeReviewThread } from "../serialize-review-thread/index.ts"
import { reviewReactionContents } from "../types.ts"
import type { ReviewMessage, ReviewThread } from "../types.ts"

export function serializeReviewCollaboration(
  stored: CollaborationThread,
  viewerId: string,
): ReviewThread {
  const thread = serializeReviewThread(stored)
  const messages = new Map(stored.comments.map((comment) => [comment.id, comment]))
  function present(message: ReviewMessage) {
    const stored = messages.get(message.storageId)
    if (!stored || message.deletedAt) return message
    const mentions = stored.mentions.map(({ login, recipientKey }) => ({
      login,
      githubId: githubReviewId(recipientKey),
    }))
    const reactions = reviewReactionContents.flatMap((content) => {
      const users = stored.reactions.filter((reaction) => reaction.content === content)
      return users.length
        ? [
            {
              content,
              count: users.length,
              viewerHasReacted: users.some(({ userId }) => userId === viewerId),
            },
          ]
        : []
    })
    return { ...message, mentions, reactions }
  }
  return {
    ...thread,
    activityVersion: stored.collaborationVersion,
    root: present(thread.root),
    replies: thread.replies.map(present),
    viewerLastSeenActivityVersion: stored.reads[0]?.activityVersion ?? null,
  }
}
