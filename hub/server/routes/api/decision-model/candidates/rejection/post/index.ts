import type { RequestHandler } from "express"
import { z } from "zod"

import { readAdministrator } from "../../../read-administrator/index.ts"
import { respondDecisionModelError } from "../../../respond-decision-model-error/index.ts"
import type { DecisionModelRouteDependencies } from "../../../types.ts"

const body = z.object({ reason: z.string().trim().min(1).max(500) }).strict()

export function post(dependencies: DecisionModelRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = z.uuid().parse(request.params.repositoryId)
      const candidateId = z.uuid().parse(request.params.candidateId)
      const session = await readAdministrator(request, response, dependencies)
      if (!session) return
      response.json(
        await dependencies.rejectCandidate({
          repositoryId,
          actorMembershipId: session.membershipId,
          candidateId,
          reason: body.parse(request.body).reason,
        }),
      )
    } catch (error) {
      if (!respondDecisionModelError(response, error)) next(error)
    }
  }
}
