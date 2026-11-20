import type { Request, RequestHandler } from "express"
import { z } from "zod"

import { reviewReactionContents } from "../../../../domains/review-comments/types.ts"
import type { ReviewMutationScope } from "../../../../domains/review-comments/types.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import type { ReviewRouteDependencies } from "../../product/types.ts"
import { presentReviewThreadComments } from "../present-review-thread-comments/index.ts"
import { readReviewIdentifiers } from "../read-review-identifiers/index.ts"
import { readReviewSession } from "../read-review-session/index.ts"
import { requireReviewAccess } from "../require-review-access/index.ts"
import { respondReviewError } from "../respond-review-error/index.ts"

const version = z.number().int().positive().max(2_147_483_647)
const content = z.enum(reviewReactionContents)
const reactionAdd = z.strictObject({
  review_comment_reaction: z.strictObject({ content, activity_version: version }),
})
const reactionRemove = z.strictObject({
  review_comment_reaction: z.strictObject({ activity_version: version }),
})
const readVersion = z.strictObject({
  review_thread_read: z.strictObject({ activity_version: version }),
})
const candidateQuery = z.strictObject({
  q: z
    .string()
    .regex(/^[A-Za-z0-9_-]{0,39}$/)
    .default(""),
})

export function createCollaborationHandlers(
  session: CurrentSessionDependencies,
  review: ReviewRouteDependencies,
) {
  function handle<Result>(
    permission: "view" | "change",
    run: (input: ReviewMutationScope, request: Request) => Promise<Result | null>,
  ): RequestHandler {
    return async (request, response, next) => {
      try {
        const actor = await readReviewSession(request, session)
        if (!actor) {
          response.status(401).json({ error: "Sign in to continue." })
          return
        }
        const identifiers = readReviewIdentifiers(request, ["repositoryId", "prototypeId"])
        if (!identifiers) {
          response.status(400).json({ error: "Enter a valid review address." })
          return
        }
        if (
          !(await requireReviewAccess(
            response,
            review,
            identifiers.repositoryId,
            actor,
            permission,
          ))
        )
          return
        const result = await run(
          { ...identifiers, sessionDigest: actor.sessionDigest, actor },
          request,
        )
        if (result === null) {
          response.status(400).json({ error: "The review request is invalid." })
          return
        }
        if (permission === "view") {
          const current = await readReviewSession(request, session)
          if (!current || current.userId !== actor.userId) {
            response.status(401).json({ error: "Sign in to continue." })
            return
          }
          if (
            !(await requireReviewAccess(
              response,
              review,
              identifiers.repositoryId,
              current,
              "view",
            ))
          )
            return
        }
        response.json(result)
      } catch (error) {
        if (!respondReviewError(error, response)) next(error)
      }
    }
  }

  function react(add: boolean) {
    return handle("change", async (input, request) => {
      const identifiers = readReviewIdentifiers(request, ["commentId"])
      const parsed = add
        ? reactionAdd.safeParse(request.body)
        : reactionRemove.safeParse(request.body)
      if (!identifiers || !parsed.success) return null
      const reaction = parsed.data.review_comment_reaction
      const choice = content.safeParse(
        "content" in reaction ? reaction.content : request.params.content,
      )
      if (!choice.success) return null
      const commentId = Number(identifiers.commentId)
      const thread = await review.reviewComments.setReaction({
        ...input,
        commentId,
        add,
        content: choice.data,
        activityVersion: reaction.activity_version,
      })
      const comments = presentReviewThreadComments(thread, input.actor.userId)
      return { comments: comments.filter(({ id }) => id === thread.id || id === commentId) }
    })
  }

  function markRead(read: boolean) {
    return handle("change", async (input, request) => {
      const identifiers = readReviewIdentifiers(request, ["threadId"])
      if (!identifiers) return null
      const parsed = read ? readVersion.safeParse(request.body) : null
      if (parsed && !parsed.success) return null
      const thread = await review.reviewComments.markThreadRead({
        ...input,
        threadId: Number(identifiers.threadId),
        activityVersion: parsed?.data.review_thread_read.activity_version ?? null,
      })
      return { comments: [presentReviewThreadComments(thread, input.actor.userId)[0]] }
    })
  }
  return {
    addReaction: react(true),
    removeReaction: react(false),
    markRead: markRead(true),
    markUnread: markRead(false),
    mentionCandidates: handle("view", async (input, request) => {
      const query = candidateQuery.safeParse(request.query)
      if (!query.success || !review.searchReviewMentions) return null
      const candidates = await review.searchReviewMentions(
        input.repositoryId,
        input.prototypeId,
        query.data.q.toLowerCase(),
        input.actor.userId,
      )
      // Recheck the branch itself after the provider request as well.
      if (
        review.isPrototypeReviewable &&
        !(await review.isPrototypeReviewable(input.repositoryId, input.prototypeId))
      )
        return null
      return { candidates }
    }),
  }
}
