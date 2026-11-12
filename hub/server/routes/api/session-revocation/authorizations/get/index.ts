import type { RequestHandler } from "express"
import { z } from "zod"

import type { SessionRevocationRouteDependencies } from "../../../auth/types.ts"
import { readAdministratorSession } from "../../../administrators/read-administrator-session/index.ts"

const parametersSchema = z.object({ id: z.uuid() }).strict()

export function get(dependencies: SessionRevocationRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    response.locals.omitLogPayload = true
    const parameters = parametersSchema.safeParse(request.params)
    if (!parameters.success) {
      response.status(400).json({ error: "The authorization identifier is invalid." })
      return
    }
    try {
      const session = await readAdministratorSession(request, dependencies)
      if (!session) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const authorization = await dependencies.getAuthorization({
        authorizationId: parameters.data.id,
        hubSessionId: session.id,
      })
      if (!authorization || authorization.operation !== "END_ALL_HUB_SESSIONS") {
        response.status(410).json({ error: "The authorization is no longer available." })
        return
      }
      response.json({
        authorization: {
          expiresAt: authorization.expiresAt,
          operation: authorization.operation,
          verifiedAt: authorization.verifiedAt,
        },
      })
    } catch (error) {
      next(error)
    }
  }
}
