import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../read-learning-session/index.ts"
import { respondLearningError } from "../respond-learning-error/index.ts"
import type { LearningsRouteDependencies } from "../types.ts"

/**
 * Serves a repository's Learnings library. Every member who can see the repository can
 * read it, while only repository administrators decide, run, and see usage. Access is
 * read again after loading so a revoked session or lost authority never sees more.
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
      const administrator = await dependencies.authorizeRepositoryAdministration({
        membershipId: initial.membershipId,
        repositoryId: repository.id,
      })

      const [overview, copilot, runSummary] = await Promise.all([
        dependencies.getOverview({
          repositoryId: repository.id,
          viewer: `human:${initial.login}`,
        }),
        dependencies.getCopilot(),
        administrator ? dependencies.listRuns(repository.id) : null,
      ])
      const current = await readLearningSession(request, dependencies)
      if (!current || current.membershipId !== initial.membershipId) {
        response.status(401).json({ code: "sign_in_required", error: "Sign in to continue." })
        return
      }
      if (!(await dependencies.findRepository(current, repository.id))) {
        response.status(404).json({ code: "repository_not_found", error: "Repository not found." })
        return
      }
      const stillAdministrator =
        runSummary !== null &&
        (await dependencies.authorizeRepositoryAdministration({
          membershipId: current.membershipId,
          repositoryId: repository.id,
        }))
      const runAvailable =
        stillAdministrator &&
        dependencies.requestRun !== undefined &&
        copilot.state === "connected" &&
        (runSummary.active === null ||
          (runSummary.active.scheduled && runSummary.active.state === "QUEUED"))
      response.json({
        accessDenied: false,
        repository,
        capabilities: {
          administerHub: current.role === "ADMINISTRATOR",
          administerRepository: stillAdministrator,
        },
        permissions: {
          viewEvidence: true,
          decide: stillAdministrator,
          requestRun: stillAdministrator && dependencies.requestRun !== undefined,
        },
        copilot,
        automaticRunsEnabled: dependencies.automaticRunsEnabled,
        usageCredits: stillAdministrator ? runSummary.usageCredits : null,
        runAvailable,
        ...overview,
        runs: stillAdministrator ? runSummary.runs : [],
      })
    } catch (error) {
      if (!respondLearningError(response, error)) next(error)
    }
  }
}
