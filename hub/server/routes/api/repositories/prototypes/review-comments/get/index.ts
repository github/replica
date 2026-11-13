import type { RequestHandler } from "express"

import type { CurrentSessionDependencies } from "../../../../auth/types.ts"
import type { ProductRouteDependencies } from "../../../../product/types.ts"
import { readReviewIdentifiers } from "../../../../review-comments/read-review-identifiers/index.ts"
import { readReviewSession } from "../../../../review-comments/read-review-session/index.ts"
import { presentReviewThreadComments } from "../../../../review-comments/present-review-thread-comments/index.ts"
import { respondReviewError } from "../../../../review-comments/respond-review-error/index.ts"

export function get(
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
      const identifiers = readReviewIdentifiers(request, ["repositoryId", "prototypeId"])
      if (!identifiers) {
        response.status(400).json({ error: "Enter a valid review address." })
        return
      }
      const threads = await reviewComments.listPrototypeThreads(
        identifiers.repositoryId,
        identifiers.prototypeId,
      )
      const comments = threads
        .flatMap((thread) => presentReviewThreadComments(thread, current.userId))
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id,
        )
      response.json({ comments, nextCursor: null, hasMore: false })
    } catch (error) {
      if (!respondReviewError(error, response)) next(error)
    }
  }
}
