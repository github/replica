import type { RequestHandler } from "express"

import type { CurrentSessionDependencies } from "../../../../auth/types.ts"
import type { ReviewRouteDependencies } from "../../../../product/types.ts"
import { readReviewIdentifiers } from "../../../../review-comments/read-review-identifiers/index.ts"
import { readReviewSession } from "../../../../review-comments/read-review-session/index.ts"
import { presentReviewThreadComments } from "../../../../review-comments/present-review-thread-comments/index.ts"
import { requireReviewAccess } from "../../../../review-comments/require-review-access/index.ts"
import { respondReviewError } from "../../../../review-comments/respond-review-error/index.ts"

export function get(
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
          current,
          "view",
        ))
      ) {
        return
      }
      const threads = await review.reviewComments.listPrototypeThreads(
        identifiers.repositoryId,
        identifiers.prototypeId,
      )
      const final = await readReviewSession(request, session)
      if (!final || final.membershipId !== current.membershipId) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      if (
        !(await requireReviewAccess(
          response,
          review,
          identifiers.repositoryId,
          final,
          "view",
        ))
      ) {
        return
      }
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
