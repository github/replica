import type { RequestHandler } from "express"
import { z } from "zod"

import type { CurrentSessionDependencies } from "../../../../../auth/types.ts"
import type { ReviewRouteDependencies } from "../../../../../product/types.ts"
import { readReviewIdentifiers } from "../../../../../review-comments/read-review-identifiers/index.ts"
import { readReviewSession } from "../../../../../review-comments/read-review-session/index.ts"
import { presentReviewThreadComments } from "../../../../../review-comments/present-review-thread-comments/index.ts"
import { requireReviewAccess } from "../../../../../review-comments/require-review-access/index.ts"
import { respondReviewError } from "../../../../../review-comments/respond-review-error/index.ts"

const bodySchema = z.strictObject({
  review_outcome: z.strictObject({
    kind: z.enum(["confirmed_fixed", "still_present", "not_applicable", "needs_more_review"]),
    build_number: z.number().int().positive(),
    feedback_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    resolution_event_id: z.uuid(),
    activity_version: z.number().int().positive(),
  }),
})

export function post(
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
      const body = bodySchema.safeParse(request.body)
      if (!identifiers || !body.success) {
        response.status(400).json({ error: "Enter a valid review result." })
        return
      }
      if (
        !(await requireReviewAccess(response, review, identifiers.repositoryId, current, "change"))
      ) {
        return
      }
      const input = body.data.review_outcome
      const thread = await review.reviewComments.recordOutcome({
        sessionDigest: current.sessionDigest,
        repositoryId: identifiers.repositoryId,
        prototypeId: identifiers.prototypeId,
        threadId: Number(identifiers.threadId),
        buildNumber: input.build_number,
        kind: input.kind,
        feedbackDigest: input.feedback_digest,
        resolutionEventId: input.resolution_event_id,
        activityVersion: input.activity_version,
        actor: current,
      })
      response.json({ comments: [presentReviewThreadComments(thread, current.userId)[0]] })
    } catch (error) {
      if (!respondReviewError(error, response)) next(error)
    }
  }
}
