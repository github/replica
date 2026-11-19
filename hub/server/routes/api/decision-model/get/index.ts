import type { RequestHandler } from "express"
import { z } from "zod"

import { readDecisionModelMember } from "../read-decision-model-member/index.ts"
import { parseDecisionModelRequest } from "../parse-decision-model-request/index.ts"
import { respondDecisionModelError } from "../respond-decision-model-error/index.ts"
import type { DecisionModelRouteDependencies } from "../types.ts"

export function get(dependencies: DecisionModelRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = parseDecisionModelRequest(z.uuid(), request.params.repositoryId)
      const session = await readDecisionModelMember(request, response, dependencies)
      if (!session) return
      response.json(
        await dependencies.getOverview({
          repositoryId,
          actorMembershipId: session.membershipId,
        }),
      )
    } catch (error) {
      if (!respondDecisionModelError(response, error)) next(error)
    }
  }
}
