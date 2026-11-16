import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../read-learning-session/index.ts"
import type { LearningsRouteDependencies } from "../types.ts"

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
      if (initial.role !== "ADMINISTRATOR") {
        response.json({ accessDenied: true, repository, canAdministerHub: false })
        return
      }

      const [overview, copilot, runSummary] = await Promise.all([
        dependencies.getOverview({
          repositoryId: repository.id,
          viewer: `human:${initial.login}`,
        }),
        dependencies.getCopilot(),
        dependencies.listRuns(repository.id),
      ])
      const current = await readLearningSession(request, dependencies)
      if (!current || current.membershipId !== initial.membershipId) {
        response.status(401).json({ code: "sign_in_required", error: "Sign in to continue." })
        return
      }
      if (current.role !== "ADMINISTRATOR") {
        response.json({ accessDenied: true, repository, canAdministerHub: false })
        return
      }
      const runAvailable =
        dependencies.requestRun !== undefined && copilot.state === "connected" && !runSummary.active
      response.json({
        accessDenied: false,
        repository,
        canAdministerHub: true,
        permissions: { decide: true, requestRun: dependencies.requestRun !== undefined },
        copilot,
        usageCredits: runSummary.usageCredits,
        runAvailable,
        ...overview,
        runs: runSummary.runs,
      })
    } catch (error) {
      next(error)
    }
  }
}
