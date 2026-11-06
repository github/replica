import type { ImprovementThread } from "@features/prototype-canvas-improvement-threads/types"
import type { Note } from "../types"
import type { AnchorResolution } from "@utils/review-anchor/types"
import { copy } from "../en"

export function improvementThreadView(
  note: Note,
  resolution?: AnchorResolution,
): ImprovementThread {
  const work = [
    note.thread.originalStatus,
    ...note.thread.messages
      .filter((message) => message.role === "author")
      .map((message) => message.status),
  ]
  return {
    id: note.id,
    revision: note.revision,
    body: note.body,
    author: note.thread.originalAuthor
      ? `@${note.thread.originalAuthor.login}`
      : note.author === "local"
        ? copy.localAuthor
        : `@${note.author}`,
    avatarUrl: note.thread.originalAuthor?.avatarUrl,
    target: note.target,
    path: note.route,
    status: note.status,
    originalPending: note.thread.originalStatus === "open",
    ...(work.includes("sent")
      ? { retryStatus: "sent" }
      : work.includes("blocked")
        ? { retryStatus: "blocked" }
        : {}),
    messages: note.thread.messages.map((message) => ({
      ...message,
      ...(message.role === "author" && message.author
        ? { author: `@${message.author.login}`, avatarUrl: message.author.avatarUrl }
        : { author: undefined }),
      pending: message.role === "author" && message.status === "open",
    })),
    ...(resolution && (resolution.status === "resolved" || resolution.status === "moved")
      ? { point: resolution.point }
      : {}),
  }
}
