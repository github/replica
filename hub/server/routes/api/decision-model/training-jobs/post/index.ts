import type { RequestHandler } from "express"
import { z } from "zod"

import { readDecisionModelMember } from "../../read-decision-model-member/index.ts"
import { parseDecisionModelRequest } from "../../parse-decision-model-request/index.ts"
import { respondDecisionModelError } from "../../respond-decision-model-error/index.ts"
import type { DecisionModelRouteDependencies } from "../../types.ts"

const body = z
  .object({
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/),
  })
  .strict()

export function post(dependencies: DecisionModelRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = parseDecisionModelRequest(z.uuid(), request.params.repositoryId)
      const session = await readDecisionModelMember(request, response, dependencies)
      if (!session) return
      const input = parseDecisionModelRequest(body, request.body)
      response.status(202).json(
        await dependencies.requestTraining({
          repositoryId,
          actorMembershipId: session.membershipId,
          idempotencyKey: input.idempotencyKey,
        }),
      )
    } catch (error) {
      if (!respondDecisionModelError(response, error)) next(error)
    }
  }
}
