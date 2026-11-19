import type { RequestHandler } from "express"
import { z } from "zod"

import { readDecisionModelMember } from "../../read-decision-model-member/index.ts"
import { parseDecisionModelRequest } from "../../parse-decision-model-request/index.ts"
import { respondDecisionModelError } from "../../respond-decision-model-error/index.ts"
import type { DecisionModelRouteDependencies } from "../../types.ts"

const body = z.object({ expectedGeneration: z.number().int().positive() }).strict()

export function post(dependencies: DecisionModelRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = parseDecisionModelRequest(z.uuid(), request.params.repositoryId)
      const session = await readDecisionModelMember(request, response, dependencies)
      if (!session) return
      response.json(
        await dependencies.rollback({
          repositoryId,
          actorMembershipId: session.membershipId,
          actorLogin: session.login,
          expectedGeneration: parseDecisionModelRequest(body, request.body).expectedGeneration,
        }),
      )
    } catch (error) {
      if (!respondDecisionModelError(response, error)) next(error)
    }
  }
}
