import type { RequestHandler } from "express"
import { z } from "zod"

import { validateDecisionModelSettings } from "../../../../domains/decision-model/validate-decision-model-settings/index.ts"
import { readAdministrator } from "../read-administrator/index.ts"
import { respondDecisionModelError } from "../respond-decision-model-error/index.ts"
import type { DecisionModelRouteDependencies } from "../types.ts"

export function patch(dependencies: DecisionModelRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = z.uuid().parse(request.params.repositoryId)
      const session = await readAdministrator(request, response, dependencies)
      if (!session) return
      response.json(
        await dependencies.saveSettings({
          repositoryId,
          actorMembershipId: session.membershipId,
          settings: validateDecisionModelSettings(request.body),
        }),
      )
    } catch (error) {
      if (!respondDecisionModelError(response, error)) next(error)
    }
  }
}
