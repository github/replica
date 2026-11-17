import type { RequestHandler } from "express"

import type { CurrentSessionDependencies } from "../../../../../auth/types.ts"
import type { ProductRouteDependencies } from "../../../../../product/types.ts"
import { readReviewIdentifiers } from "../../../../../review-comments/read-review-identifiers/index.ts"
import { readReviewSession } from "../../../../../review-comments/read-review-session/index.ts"
import { presentReviewThreadComments } from "../../../../../review-comments/present-review-thread-comments/index.ts"
import { respondReviewError } from "../../../../../review-comments/respond-review-error/index.ts"

export function delete_(
  session: CurrentSessionDependencies,
  reviewComments: NonNullable<ProductRouteDependencies["reviewComments"]>,
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
      if (!identifiers) {
        response.status(400).json({ error: "Enter a valid review comment address." })
        return
      }
      const thread = await reviewComments.deleteComment({
        sessionDigest: current.sessionDigest,
        repositoryId: identifiers.repositoryId,
        prototypeId: identifiers.prototypeId,
        commentId: Number(identifiers.commentId),
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
