import { randomUUID } from "node:crypto"

import type { Prisma, ReviewNotificationKind } from "../../../generated/prisma/client.ts"
import {
  findReviewActivityContext,
  reviewPersonKeys,
  saveReviewActivity,
} from "../../../repositories/review-comments/collaboration-queries/index.ts"
import type { ReviewActivity } from "../../../repositories/review-comments/create-review-comment-repository/index.ts"
import type { ReviewActor, ReviewMentionRecipient } from "../types.ts"

export async function applyReviewActivity(
  transaction: Prisma.TransactionClient,
  actor: ReviewActor,
  activity: ReviewActivity,
  mentions: ReviewMentionRecipient[] = [],
) {
  const changes: Parameters<typeof saveReviewActivity>[1] = {
    commentId: activity.commentId,
    mentionIdsRemoved: [],
    mentionsAdded: [],
    changedMentionLogins: [],
    notifications: [],
  }
  if (activity.kind === "deleted") {
    await saveReviewActivity(transaction, { ...changes, deleteMessage: true })
    return
  }
  const context = await findReviewActivityContext(transaction, activity.threadId)
  const source = context.comments.find(({ id }) => id === activity.commentId)
  if (!source) throw new Error("Review activity has no source message.")
  const isLocal = Boolean(context.repository.localPath)
  const personIds = new Set([actor.userId, ...context.comments.map(({ authorId }) => authorId)])
  if (context.prototype.authorId) personIds.add(context.prototype.authorId)
  const keys = await reviewPersonKeys(transaction, [...personIds], isLocal)
  const actorKey = keys.get(actor.userId)
  function record(
    recipientKey: string | undefined,
    kind: ReviewNotificationKind,
    sourceKey: string,
    source: Pick<
      Prisma.ReviewNotificationCreateManyInput,
      "reactionContent" | "reactionId" | "mentionId"
    > = {},
  ) {
    if (!recipientKey || recipientKey === actorKey) return
    changes.notifications.push({
      recipientKey,
      kind,
      sourceKey,
      ...source,
      actorId: actor.userId,
      actorLogin: actor.login,
      actorName: actor.name,
      commentId: activity.commentId,
    })
  }

  const direct = new Set<string>()
  if (activity.kind === "comment" || activity.kind === "reply" || activity.kind === "edited") {
    const active = mentions.filter(({ recipientKey }) => recipientKey !== actorKey)
    const oldByRecipient = new Map(
      source.mentions.map((mention) => [mention.recipientKey, mention]),
    )
    for (const mention of active) {
      if (direct.has(mention.recipientKey)) continue
      direct.add(mention.recipientKey)
      const old = oldByRecipient.get(mention.recipientKey)
      if (!old) {
        const id = randomUUID()
        changes.mentionsAdded.push({ ...mention, id, commentId: activity.commentId })
        record(mention.recipientKey, "mention", `mention:${id}`, { mentionId: id })
      } else if (old.login !== mention.login) {
        // A renamed account keeps the notice and immutable recipient.
        changes.changedMentionLogins.push({ id: old.id, login: mention.login })
      }
    }
    for (const old of source.mentions) {
      if (!direct.has(old.recipientKey)) {
        changes.mentionIdsRemoved.push(old.id)
      }
    }
  }

  const recipients = new Set<string | undefined>()
  if ((activity.kind === "comment" || activity.kind === "reply") && context.prototype.authorId) {
    recipients.add(keys.get(context.prototype.authorId))
  }
  if (activity.kind === "reply" || activity.kind === "resolved" || activity.kind === "reopened") {
    for (const comment of context.comments) {
      recipients.add(keys.get(comment.authorId))
      if (!comment.deletedAt) {
        for (const mention of comment.mentions) recipients.add(mention.recipientKey)
      }
    }
  }
  if (activity.kind === "reaction") {
    record(keys.get(source.authorId), "reaction", `reaction:${activity.sourceId}`, {
      reactionContent: activity.content,
      reactionId: activity.sourceId,
    })
  } else if (
    activity.kind === "comment" ||
    activity.kind === "reply" ||
    activity.kind === "resolved" ||
    activity.kind === "reopened"
  ) {
    for (const recipient of recipients) {
      if (recipient && !direct.has(recipient)) {
        record(recipient, activity.kind, `${activity.kind}:${activity.sourceId}`)
      }
    }
  }
  await saveReviewActivity(transaction, changes)
}
