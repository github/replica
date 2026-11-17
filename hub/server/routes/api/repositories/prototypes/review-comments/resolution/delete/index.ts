import type { RequestHandler } from "express"

import type { CurrentSessionDependencies } from "../../../../../auth/types.ts"
import type { ReviewRouteDependencies } from "../../../../../product/types.ts"
import { readReviewIdentifiers } from "../../../../../review-comments/read-review-identifiers/index.ts"
import { readReviewSession } from "../../../../../review-comments/read-review-session/index.ts"
import { presentReviewThreadComments } from "../../../../../review-comments/present-review-thread-comments/index.ts"
import { requireReviewAccess } from "../../../../../review-comments/require-review-access/index.ts"
import { respondReviewError } from "../../../../../review-comments/respond-review-error/index.ts"

export function delete_(
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
        "threadId",
      ])
      if (!identifiers) {
        response.status(400).json({ error: "Enter a valid review thread address." })
        return
      }
      if (
        !(await requireReviewAccess(response, review, identifiers.repositoryId, current, "change"))
      ) {
        return
      }
      const thread = await review.reviewComments.setResolution({
        sessionDigest: current.sessionDigest,
        repositoryId: identifiers.repositoryId,
        prototypeId: identifiers.prototypeId,
        threadId: Number(identifiers.threadId),
        resolved: false,
        actor: current,
      })
      response.json({ comments: [presentReviewThreadComments(thread, current.userId)[0]] })
    } catch (error) {
      if (!respondReviewError(error, response)) next(error)
    }
  }
}
