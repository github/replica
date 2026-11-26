import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../../read-learning-session/index.ts"
import { respondLearningError } from "../../respond-learning-error/index.ts"
import type { LearningsRouteDependencies } from "../../types.ts"

const learningIdSchema = z
  .string()
  .regex(/^[a-z0-9._~-]+$/i)
  .refine((value) => value !== "." && value !== "..")

/**
 * Serves one learning's decisions and evidence to anyone who can read the library.
 * Access is read again after loading so a revoked session never sees the result.
 */
export function get(dependencies: LearningsRouteDependencies): RequestHandler {
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
      const initial = await readLearningSession(request, dependencies)
      if (!initial) {
        response.status(401).json({ code: "sign_in_required", error: "Sign in to continue." })
        return
      }
      if (!(await dependencies.findRepository(initial, repositoryId.data))) {
        response.status(404).json({ code: "repository_not_found", error: "Repository not found." })
        return
      }
      const history = await dependencies.getHistory({
        repositoryId: repositoryId.data,
        learningId: learningId.data,
      })
      const current = await readLearningSession(request, dependencies)
      if (!current || current.membershipId !== initial.membershipId) {
        response.status(401).json({ code: "sign_in_required", error: "Sign in to continue." })
        return
      }
      if (!(await dependencies.findRepository(current, repositoryId.data))) {
        response.status(404).json({ code: "repository_not_found", error: "Repository not found." })
        return
      }
      response.json(history)
    } catch (error) {
      if (!respondLearningError(response, error)) next(error)
    }
  }
}
