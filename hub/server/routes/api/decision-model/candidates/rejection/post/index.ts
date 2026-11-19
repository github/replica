import type { RequestHandler } from "express"
import { z } from "zod"

import { readDecisionModelMember } from "../../../read-decision-model-member/index.ts"
import { parseDecisionModelRequest } from "../../../parse-decision-model-request/index.ts"
import { respondDecisionModelError } from "../../../respond-decision-model-error/index.ts"
import type { DecisionModelRouteDependencies } from "../../../types.ts"

const body = z.object({ reason: z.string().trim().min(1).max(500) }).strict()

export function post(dependencies: DecisionModelRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = parseDecisionModelRequest(z.uuid(), request.params.repositoryId)
      const candidateId = parseDecisionModelRequest(z.uuid(), request.params.candidateId)
      const session = await readDecisionModelMember(request, response, dependencies)
      if (!session) return
      response.json(
        await dependencies.rejectCandidate({
          repositoryId,
          actorMembershipId: session.membershipId,
          candidateId,
          reason: parseDecisionModelRequest(body, request.body).reason,
        }),
      )
    } catch (error) {
      if (!respondDecisionModelError(response, error)) next(error)
    }
  }
}
