import type { RequestHandler } from "express"
import { z } from "zod"

import type { CurrentSessionDependencies } from "../../../../../auth/types.ts"
import type { ReviewRouteDependencies } from "../../../../../product/types.ts"
import { readReviewIdentifiers } from "../../../../../review-comments/read-review-identifiers/index.ts"
import { readReviewSession } from "../../../../../review-comments/read-review-session/index.ts"
import { presentReviewThreadComments } from "../../../../../review-comments/present-review-thread-comments/index.ts"
import { requireReviewAccess } from "../../../../../review-comments/require-review-access/index.ts"
import { respondReviewError } from "../../../../../review-comments/respond-review-error/index.ts"

const bodySchema = z.object({ review_comment: z.object({ body: z.unknown() }).strict() }).strict()

export function patch(
  session: CurrentSessionDependencies,
  review: ReviewRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const current = await readReviewSession(request, session)
      if (!current) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const identifiers = readReviewIdentifiers(request, [
        "repositoryId",
        "prototypeId",
        "commentId",
      ])
      const body = bodySchema.safeParse(request.body)
      if (!identifiers || !body.success) {
        response.status(400).json({ error: "The review comment request is invalid." })
        return
      }
      if (
        !(await requireReviewAccess(
          response,
          review,
          identifiers.repositoryId,
          current,
          "change",
        ))
      ) {
        return
      }
      const thread = await review.reviewComments.editComment({
        sessionDigest: current.sessionDigest,
        repositoryId: identifiers.repositoryId,
        prototypeId: identifiers.prototypeId,
        commentId: Number(identifiers.commentId),
        body: body.data.review_comment.body,
        actor: current,
      })
      const comments = presentReviewThreadComments(thread, current.userId)
      const changed = comments.find((comment) => comment.id === Number(identifiers.commentId))
      if (!changed) throw new Error("The changed review comment is missing from its thread.")
      response.json({
        comments: changed.kind === "root" ? [changed] : [changed, comments[0]],
      })
    } catch (error) {
      if (!respondReviewError(error, response)) next(error)
    }
  }
}
