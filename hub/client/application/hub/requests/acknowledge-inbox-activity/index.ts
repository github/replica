import { NOTIFICATION_READ_SCHEMA, NOTIFICATION_SCHEMA } from "@utils/notification/schemas"
import { notifyInboxRead } from "@utils/notification/read-updates"

import { requestJson } from "../request-json"

export async function acknowledgeInboxActivity(
  input: {
    viewerId: string
    notificationId: number
    prototypeId: string
    threadId: number
    commentId: number
  },
  signal: AbortSignal,
) {
  const url = new URL(`/api/notifications/${input.notificationId}`, window.location.origin)
  const notice = await requestJson(url, NOTIFICATION_SCHEMA, { signal })
  if (
    notice.id !== input.notificationId ||
    notice.target.prototypeId !== input.prototypeId ||
    notice.target.threadId !== input.threadId ||
    notice.target.commentId !== input.commentId
  ) {
    throw new Error("The Inbox activity does not match this review message.")
  }
  if (!notice.read && !signal.aborted) {
    const startedAt = performance.now()
    const saved = await requestJson(url, NOTIFICATION_READ_SCHEMA, {
      method: "PATCH",
      signal,
      body: JSON.stringify({ notification: { read: true, version: notice.version } }),
    })
    if (!signal.aborted)
      notifyInboxRead({ viewerId: input.viewerId, id: notice.id, saved, startedAt })
  }
}
