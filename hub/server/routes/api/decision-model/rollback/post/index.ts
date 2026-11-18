import type { RequestHandler } from "express"
import { z } from "zod"

import { readAdministrator } from "../../read-administrator/index.ts"
import { respondDecisionModelError } from "../../respond-decision-model-error/index.ts"
import type { DecisionModelRouteDependencies } from "../../types.ts"

const body = z.object({ expectedGeneration: z.number().int().positive() }).strict()

export function post(dependencies: DecisionModelRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = z.uuid().parse(request.params.repositoryId)
      const session = await readAdministrator(request, response, dependencies)
      if (!session) return
      response.json(
        await dependencies.rollback({
          repositoryId,
          actorMembershipId: session.membershipId,
          actorLogin: session.login,
          expectedGeneration: body.parse(request.body).expectedGeneration,
        }),
      )
    } catch (error) {
      if (!respondDecisionModelError(response, error)) next(error)
    }
  }
}
