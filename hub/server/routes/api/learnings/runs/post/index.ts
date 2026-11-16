import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../../read-learning-session/index.ts"
import { respondLearningError } from "../../respond-learning-error/index.ts"
import type { LearningsRouteDependencies } from "../../types.ts"

export function post(dependencies: LearningsRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      if (!repositoryId.success) {
        response.status(400).json({
          code: "invalid_repository",
          error: "Enter a valid repository address.",
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
      if (!dependencies.requestRun) {
        response.status(409).json({
          code: "review_snapshot_unavailable",
          error:
            "Learnings cannot run until Hub can capture a complete repository review snapshot.",
        })
        return
      }
      response.status(202).json(
        await dependencies.requestRun({
          actorMembershipId: current.membershipId,
          repositoryId: repositoryId.data,
          requestedById: current.userId,
        }),
      )
    } catch (error) {
      if (!respondLearningError(response, error)) next(error)
    }
  }
}
