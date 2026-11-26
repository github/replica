import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../../read-learning-session/index.ts"
import { readLearningSessionDigest } from "../../read-learning-session-digest/index.ts"
import { respondLearningError } from "../../respond-learning-error/index.ts"
import type { ProductViewer } from "../../../product/types.ts"
import type { LearningsRouteDependencies } from "../../types.ts"

const shareSchema = z.object({ shared: z.boolean() }).strict()
const learningIdSchema = z
  .string()
  .max(255)
  .regex(/^[a-z0-9._~-]+$/i)
  .refine((value) => value !== "." && value !== "..")
const denied = {
  code: "repository_administrator_required",
  error: "Hub and repository administrator access is required.",
}

/** Why a signed-in Hub administrator may not change this repository's shares, if any. */
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
      operation: "learning_share",
      repositoryId,
    })
    return { status: 403, body: denied }
  }
  return null
}

/**
 * Shares a learning with every repository in Hub, or stops sharing it. A Hub role alone
 * does not speak for one repository's guidance, so the person must also administer the
 * repository the learning came from. Access is read twice so a change mid-request counts.
 */
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
      const share = shareSchema.safeParse(request.body)
      if (!share.success) {
        response.status(422).json({
          code: "invalid_learning_share",
          error: "Choose whether to share the learning and try again.",
        })
        return
      }
      const initial = await readLearningSession(request, dependencies)
      if (!initial || initial.role !== "ADMINISTRATOR") {
        response.status(403).json(denied)
        return
      }
      const initialAccess = await checkAccess(dependencies, initial, repositoryId.data)
      if (initialAccess) {
        response.status(initialAccess.status).json(initialAccess.body)
        return
      }
      const current = await readLearningSession(request, dependencies)
      if (
        !current ||
        current.membershipId !== initial.membershipId ||
        current.role !== "ADMINISTRATOR"
      ) {
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
        await dependencies.share({
          repositoryId: repositoryId.data,
          learningId: learningId.data,
          actorMembershipId: current.membershipId,
          shared: share.data.shared,
          sessionDigest,
        }),
      )
    } catch (error) {
      if (!respondLearningError(response, error)) next(error)
    }
  }
}
