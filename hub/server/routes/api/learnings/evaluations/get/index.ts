import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../../read-learning-session/index.ts"
import { respondLearningError } from "../../respond-learning-error/index.ts"
import type { LearningsRouteDependencies } from "../../types.ts"

/**
 * Serves a repository's automated evaluation settings. Hub administrators set the shared
 * budget and repository administrators choose what the repository allows, so either may
 * read the page. Access is read again after loading so a lost role never sees more.
 */
export function get(dependencies: LearningsRouteDependencies): RequestHandler {
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
      if (!initial) {
        response.status(401).json({ code: "sign_in_required", error: "Sign in to continue." })
        return
      }
      const repository = await dependencies.findRepository(initial, repositoryId.data)
      if (!repository) {
        response.status(404).json({ code: "repository_not_found", error: "Repository not found." })
        return
      }
      const settings = await dependencies.getEvaluationSettings(repository.id)
      const current = await readLearningSession(request, dependencies)
      if (!current || current.membershipId !== initial.membershipId) {
        response.status(401).json({ code: "sign_in_required", error: "Sign in to continue." })
        return
      }
      if (!(await dependencies.findRepository(current, repository.id))) {
        response.status(404).json({ code: "repository_not_found", error: "Repository not found." })
        return
      }
      const changeBudget = current.role === "ADMINISTRATOR"
      const changeRepository = await dependencies.authorizeRepositoryAdministration({
        membershipId: current.membershipId,
        repositoryId: repository.id,
      })
      if (!changeBudget && !changeRepository) {
        response.status(403).json({
          code: "repository_administrator_required",
          error: "Repository administrator access is required.",
        })
        return
      }
      response.json({
        repository,
        ...settings,
        permissions: { changeBudget, changeRepository },
      })
    } catch (error) {
      if (!respondLearningError(response, error)) next(error)
    }
  }
}
