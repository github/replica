import type { RequestHandler } from "express"
import { z } from "zod"

import { validateDecisionModelSettings } from "../../../../domains/decision-model/validate-decision-model-settings/index.ts"
import { readDecisionModelMember } from "../read-decision-model-member/index.ts"
import { parseDecisionModelRequest } from "../parse-decision-model-request/index.ts"
import { respondDecisionModelError } from "../respond-decision-model-error/index.ts"
import type { DecisionModelRouteDependencies } from "../types.ts"

export function patch(dependencies: DecisionModelRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = parseDecisionModelRequest(z.uuid(), request.params.repositoryId)
      const session = await readDecisionModelMember(request, response, dependencies)
      if (!session) return
      response.json(
        await dependencies.saveSettings({
          repositoryId,
          actorMembershipId: session.membershipId,
          settings: parseDecisionModelRequest(
            z
              .custom<ReturnType<typeof validateDecisionModelSettings>>((value) => {
                try {
                  validateDecisionModelSettings(value)
                  return true
                } catch {
                  return false
                }
              })
              .transform((value) => validateDecisionModelSettings(value)),
            request.body,
          ),
        }),
      )
    } catch (error) {
      if (!respondDecisionModelError(response, error)) next(error)
    }
  }
}
