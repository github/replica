import type { RequestHandler } from "express"
import { z } from "zod"

import type { CurrentSessionDependencies } from "../../../../auth/types.ts"
import type { ProductRouteDependencies } from "../../../../product/types.ts"
import { readReviewIdentifiers } from "../../../../review-comments/read-review-identifiers/index.ts"
import { readReviewSession } from "../../../../review-comments/read-review-session/index.ts"
import { presentReviewThreadComments } from "../../../../review-comments/present-review-thread-comments/index.ts"
import { respondReviewError } from "../../../../review-comments/respond-review-error/index.ts"

const bodySchema = z
  .object({
    review_comment: z
      .object({
        build_number: z.number().int().positive(),
        body: z.unknown(),
        anchor: z.unknown(),
      })
      .strict(),
  })
  .strict()

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
      const identifiers = readReviewIdentifiers(request, ["repositoryId", "prototypeId"])
      const body = bodySchema.safeParse(request.body)
      if (!identifiers || !body.success) {
        response.status(400).json({ error: "The review comment request is invalid." })
        return
      }
      const thread = await reviewComments.createThread({
        sessionDigest: current.sessionDigest,
        repositoryId: identifiers.repositoryId,
        prototypeId: identifiers.prototypeId,
        buildNumber: body.data.review_comment.build_number,
        body: body.data.review_comment.body,
        anchor: body.data.review_comment.anchor,
        actor: current,
      })
      response
        .status(201)
        .json({ comments: [presentReviewThreadComments(thread, current.userId)[0]] })
    } catch (error) {
      if (!respondReviewError(error, response)) next(error)
    }
  }
}
