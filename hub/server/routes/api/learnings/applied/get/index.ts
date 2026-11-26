import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../../read-learning-session/index.ts"
import { respondLearningError } from "../../respond-learning-error/index.ts"
import type { LearningsRouteDependencies } from "../../types.ts"

const querySchema = z.object({
  prototype: z.uuid(),
  commit: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
})

/**
 * Lists the learnings agents said they applied in one prototype's commit, so a Build can
 * show them. Access is read again after loading so a revoked session never sees the result.
 */
export function get(dependencies: LearningsRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      const query = querySchema.safeParse(request.query)
      if (!repositoryId.success || !query.success) {
        response.status(400).json({
          code: "invalid_applied_learnings_address",
          error: "Name a prototype and a full commit SHA.",
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
      const applied = await dependencies
        .getAppliedLearnings({
          repositoryId: repositoryId.data,
          prototypeId: query.data.prototype,
          commitSha: query.data.commit,
        })
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        )
      const current = await readLearningSession(request, dependencies)
      if (!current || current.membershipId !== initial.membershipId) {
        response.status(401).json({ code: "sign_in_required", error: "Sign in to continue." })
        return
      }
      if (!(await dependencies.findRepository(current, repositoryId.data))) {
        response.status(404).json({ code: "repository_not_found", error: "Repository not found." })
        return
      }
      if (!applied.ok) throw applied.error
      response.json({ learnings: applied.value })
    } catch (error) {
      if (!respondLearningError(response, error)) next(error)
    }
  }
}
