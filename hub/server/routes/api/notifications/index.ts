import type { Request, RequestHandler } from "express"
import { z } from "zod"

import type { InboxActivity } from "../../../repositories/review-comments/inbox-queries/index.ts"
import type { CurrentSessionDependencies } from "../auth/types.ts"
import type { ProductRouteDependencies } from "../product/types.ts"
import { readReviewSession } from "../review-comments/read-review-session/index.ts"
import { respondReviewError } from "../review-comments/respond-review-error/index.ts"

const integerId = z.coerce.number().int().positive().max(2_147_483_647)
const filters = z.strictObject({
  unread: z.enum(["true", "false"]).default("false"),
  limit: z.coerce.number().int().min(1).max(50).default(50),
  before: integerId.optional(),
})
const readChange = z.strictObject({
  notification: z.strictObject({
    read: z.boolean(),
    version: z.number().int().nonnegative().max(2_147_483_646),
  }),
})

function present(row: InboxActivity) {
  const { repository, prototype } = row.comment.thread
  const threadId = row.comment.root?.publicId ?? row.comment.publicId
  const query = new URLSearchParams({
    comment: String(threadId),
    message: String(row.comment.publicId),
    notification: String(row.publicId),
  })
  const excerpt = row.comment.body.trim().replace(/\s+/g, " ")
  return {
    id: row.publicId,
    version: row.version,
    actor: { login: row.actorLogin, name: row.actorName, avatarUrl: null },
    kind: row.kind,
    reactionContent: row.reactionContent,
    excerpt: excerpt.length > 200 ? `${excerpt.slice(0, 199)}…` : excerpt,
    createdAt: row.createdAt,
    read: row.readAt !== null,
    repository: repository.nameWithOwner,
    prototype: prototype.name ?? prototype.branchName,
    path: `/repositories/${repository.id}/prototypes/${prototype.id}?${query}`,
    updatePath: `/api/notifications/${row.publicId}`,
    target: { prototypeId: prototype.id, threadId, commentId: row.comment.publicId },
  }
}

export function createInboxHandlers(
  session: CurrentSessionDependencies,
  inbox: NonNullable<ProductRouteDependencies["reviewInbox"]>,
) {
  function handle<T, R>(
    schema: z.ZodType<T>,
    input: (request: Request) => unknown,
    action: (
      viewer: NonNullable<Awaited<ReturnType<typeof readReviewSession>>>,
      data: T,
    ) => Promise<R>,
  ): RequestHandler {
    return async (request, response, next) => {
      try {
        const viewer = await readReviewSession(request, session)
        if (!viewer) {
          response.status(401).json({ error: "Sign in to continue." })
          return
        }
        const parsed = schema.safeParse(input(request))
        if (!parsed.success) {
          response.status(400).json({ error: "The Inbox request is invalid." })
          return
        }
        response.json(await action(viewer, parsed.data))
      } catch (error) {
        if (!respondReviewError(error, response)) next(error)
      }
    }
  }
  return {
    list: handle(
      filters,
      (request) => request.query,
      async (viewer, input) => {
        const page = await inbox.list({
          ...input,
          unread: input.unread === "true",
          viewer,
          sessionDigest: viewer.sessionDigest,
        })
        return { ...page, notifications: page.notifications.map(present) }
      },
    ),
    find: handle(
      integerId,
      (request) => request.params.notificationId,
      async (viewer, notificationId) =>
        present(await inbox.find({ viewer, sessionDigest: viewer.sessionDigest, notificationId })),
    ),
    update: handle(
      z.object({ notificationId: integerId, body: readChange }),
      (request) => ({
        notificationId: request.params.notificationId,
        body: request.body as unknown,
      }),
      (viewer, { notificationId, body }) =>
        inbox.setRead({
          viewer,
          sessionDigest: viewer.sessionDigest,
          notificationId,
          ...body.notification,
        }),
    ),
  }
}
