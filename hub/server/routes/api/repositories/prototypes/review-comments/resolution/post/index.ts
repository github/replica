import type { RequestHandler } from "express"

import type { CurrentSessionDependencies } from "../../../../../auth/types.ts"
import type { ProductRouteDependencies } from "../../../../../product/types.ts"
import { readReviewIdentifiers } from "../../../../../review-comments/read-review-identifiers/index.ts"
import { readReviewSession } from "../../../../../review-comments/read-review-session/index.ts"
import { presentReviewThreadComments } from "../../../../../review-comments/present-review-thread-comments/index.ts"
import { respondReviewError } from "../../../../../review-comments/respond-review-error/index.ts"

export function post(
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
        "threadId",
      ])
      if (!identifiers) {
        response.status(400).json({ error: "Enter a valid review thread address." })
        return
      }
      const thread = await reviewComments.setResolution({
        sessionDigest: current.sessionDigest,
        repositoryId: identifiers.repositoryId,
        prototypeId: identifiers.prototypeId,
        threadId: Number(identifiers.threadId),
        resolved: true,
        actor: current,
      })
      response.json({ comments: [presentReviewThreadComments(thread, current.userId)[0]] })
    } catch (error) {
      if (!respondReviewError(error, response)) next(error)
    }
  }
}
