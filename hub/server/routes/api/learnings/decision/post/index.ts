import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../../read-learning-session/index.ts"
import { respondLearningError } from "../../respond-learning-error/index.ts"
import type { LearningsRouteDependencies } from "../../types.ts"

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const decisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("accept"),
      digest,
      content: z.string().trim().min(1).max(2000).optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("reject"),
      digest,
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      decision: z.literal("retire"),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
])
const learningIdSchema = z
  .string()
  .regex(/^[a-z0-9._~-]+$/i)
  .refine((value) => value !== "." && value !== "..")

export function post(dependencies: LearningsRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      const learningId = learningIdSchema.safeParse(request.params.learningId)
      if (!repositoryId.success || !learningId.success) {
        response.status(400).json({
          code: "invalid_learning_address",
          error: "Enter a valid learning address.",
        })
        return
      }
      const decision = decisionSchema.safeParse(request.body)
      if (!decision.success) {
        response.status(422).json({
          code: "invalid_learning_decision",
          error: "Review the learning decision and try again.",
        })
        return
      }
      const initial = await readLearningSession(request, dependencies)
      if (!initial || initial.role !== "ADMINISTRATOR") {
        response.status(403).json({
          code: "repository_administrator_required",
          error: "Repository administrator access is required.",
        })
        return
      }
      if (!(await dependencies.findRepository(initial, repositoryId.data))) {
        response.status(404).json({ code: "repository_not_found", error: "Repository not found." })
        return
      }
      const current = await readLearningSession(request, dependencies)
      if (
        !current ||
        current.membershipId !== initial.membershipId ||
        current.role !== "ADMINISTRATOR"
      ) {
        response.status(403).json({
          code: "repository_administrator_required",
          error: "Repository administrator access is required.",
        })
        return
      }
      response.json(
        await dependencies.decide({
          repositoryId: repositoryId.data,
          learningId: learningId.data,
          actor: `human:${current.login}`,
          actorMembershipId: current.membershipId,
          decision: decision.data,
        }),
      )
    } catch (error) {
      if (!respondLearningError(response, error)) next(error)
    }
  }
}
