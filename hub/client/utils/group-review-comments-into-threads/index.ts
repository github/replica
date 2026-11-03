import type {
  ReviewComment,
  ReviewReply,
  ReviewRootComment,
  ReviewThread,
} from "@utils/review-comment/types"
import { getReviewThreadParticipants } from "@utils/get-review-thread-participants"

export function groupReviewCommentsIntoThreads(comments: ReviewComment[]): ReviewThread[] {
  const roots = new Map<number, ReviewRootComment>()
  const replies = new Map<number, ReviewReply[]>()

  for (const comment of comments) {
    if (comment.kind === "root") {
      roots.set(comment.id, comment)
      continue
    }

    const threadReplies = replies.get(comment.rootId) ?? []
    threadReplies.push(comment)
    replies.set(comment.rootId, threadReplies)
  }

  return Array.from(roots.values())
    .flatMap((root) => {
      const liveReplies = (replies.get(root.id) ?? [])
        .filter((reply) => reply.deletedAt === null)
        .sort(
          (first, second) =>
            Date.parse(first.createdAt) - Date.parse(second.createdAt) || first.id - second.id,
        )
      if (root.deletedAt !== null && liveReplies.length === 0) return []

      return [
        {
          root,
          replies: liveReplies,
          participants: getReviewThreadParticipants(
            root.author,
            liveReplies.map((reply) => reply.author),
          ),
          lastActivityAt: liveReplies.at(-1)?.createdAt ?? root.createdAt,
          unread:
            root.viewerLastSeenActivityVersion === null ||
            root.viewerLastSeenActivityVersion < root.activityVersion,
        },
      ]
    })
    .sort(
      (first, second) =>
        Date.parse(second.lastActivityAt) - Date.parse(first.lastActivityAt) ||
        second.root.id - first.root.id,
    )
}
