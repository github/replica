import type { RequestHandler } from "express"
import { z } from "zod"

import { readAdministrator } from "../../../read-administrator/index.ts"
import { respondDecisionModelError } from "../../../respond-decision-model-error/index.ts"
import type { DecisionModelRouteDependencies } from "../../../types.ts"

export function post(dependencies: DecisionModelRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = z.uuid().parse(request.params.repositoryId)
      const buildId = z.uuid().parse(request.params.buildId)
      const session = await readAdministrator(request, response, dependencies)
      if (!session) return
      response.json(
        await dependencies.evaluateBuild({
          repositoryId,
          actorMembershipId: session.membershipId,
          buildId,
        }),
      )
    } catch (error) {
      if (!respondDecisionModelError(response, error)) next(error)
    }
  }
}
