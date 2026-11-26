import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../../read-learning-session/index.ts"
import { readLearningSessionDigest } from "../../read-learning-session-digest/index.ts"
import { respondLearningError } from "../../respond-learning-error/index.ts"
import type { ProductViewer } from "../../../product/types.ts"
import type { LearningsRouteDependencies } from "../../types.ts"

const changeSchema = z
  .object({ enabled: z.boolean().optional(), screenshots: z.boolean().optional() })
  .strict()
const denied = {
  code: "repository_administrator_required",
  error: "Repository administrator access is required.",
}

/** Why a signed-in member may not change this repository's evaluations, if any. */
async function checkAccess(
  dependencies: LearningsRouteDependencies,
  session: ProductViewer,
  repositoryId: string,
) {
  const { membershipId } = session
  if (!(await dependencies.findRepository(session, repositoryId))) {
    return {
      status: 404,
      body: { code: "repository_not_found", error: "Repository not found." },
    }
  }
  if (!(await dependencies.authorizeRepositoryAdministration({ membershipId, repositoryId }))) {
    await dependencies.auditRepositoryAdministrationDenial({
      actorMembershipId: membershipId,
      operation: "learning_evaluation",
      repositoryId,
    })
    return { status: 403, body: denied }
  }
  return null
}

/**
 * Turns a repository's automated evaluations or agent screenshots on or off. Only the
 * repository's administrators speak for what it allows. Access is read twice so a change
 * mid-request counts.
 */
export function patch(dependencies: LearningsRouteDependencies): RequestHandler {
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
      const change = changeSchema.safeParse(request.body)
      if (!change.success) {
        response.status(422).json({
          code: "invalid_evaluation_settings",
          error: "Choose which evaluation settings to change and try again.",
        })
        return
      }
      const initial = await readLearningSession(request, dependencies)
      if (!initial) {
        response.status(403).json(denied)
        return
      }
      const initialAccess = await checkAccess(dependencies, initial, repositoryId.data)
      if (initialAccess) {
        response.status(initialAccess.status).json(initialAccess.body)
        return
      }
      const current = await readLearningSession(request, dependencies)
      if (!current || current.membershipId !== initial.membershipId) {
        response.status(403).json(denied)
        return
      }
      const currentAccess = await checkAccess(dependencies, current, repositoryId.data)
      if (currentAccess) {
        response.status(currentAccess.status).json(currentAccess.body)
        return
      }
      const sessionDigest = readLearningSessionDigest(request)
      if (!sessionDigest) {
        response.status(403).json(denied)
        return
      }
      response.json(
        await dependencies.changeEvaluationSettings({
          repositoryId: repositoryId.data,
          actor: `human:${current.login}`,
          actorMembershipId: current.membershipId,
          sessionDigest,
          ...change.data,
        }),
      )
    } catch (error) {
      if (!respondLearningError(response, error)) next(error)
    }
  }
}
