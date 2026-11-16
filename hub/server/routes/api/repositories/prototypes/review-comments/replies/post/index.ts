import type { RequestHandler } from "express"
import { z } from "zod"

import type { CurrentSessionDependencies } from "../../../../../auth/types.ts"
import type { ProductRouteDependencies } from "../../../../../product/types.ts"
import { readReviewIdentifiers } from "../../../../../review-comments/read-review-identifiers/index.ts"
import { readReviewSession } from "../../../../../review-comments/read-review-session/index.ts"
import { presentReviewThreadComments } from "../../../../../review-comments/present-review-thread-comments/index.ts"
import { respondReviewError } from "../../../../../review-comments/respond-review-error/index.ts"

const bodySchema = z.object({ review_comment: z.object({ body: z.unknown() }).strict() }).strict()

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
      const body = bodySchema.safeParse(request.body)
      if (!identifiers || !body.success) {
        response.status(400).json({ error: "The review reply request is invalid." })
        return
      }
      const thread = await reviewComments.createReply({
        sessionDigest: current.sessionDigest,
        repositoryId: identifiers.repositoryId,
        prototypeId: identifiers.prototypeId,
        threadId: Number(identifiers.threadId),
        body: body.data.review_comment.body,
        actor: current,
      })
      const comments = presentReviewThreadComments(thread, current.userId)
      const reply = comments.at(-1)
      if (!reply || reply.kind !== "reply") {
        throw new Error("The new review reply is missing from its thread.")
      }
      response.status(201).json({ comments: [reply, comments[0]] })
    } catch (error) {
      if (!respondReviewError(error, response)) next(error)
    }
  }
}
