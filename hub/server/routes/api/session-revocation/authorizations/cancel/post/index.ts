import type { RequestHandler } from "express"
import { z } from "zod"

import type { SessionRevocationRouteDependencies } from "../../../../auth/types.ts"
import { readAdministratorSession } from "../../../../administrators/read-administrator-session/index.ts"

const bodySchema = z.object({ authorizationId: z.uuid() }).strict()

export function post(dependencies: SessionRevocationRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    response.locals.omitLogPayload = true
    const body = bodySchema.safeParse(request.body)
    if (!body.success) {
      response.status(400).json({ error: "The authorization cancellation is invalid." })
      return
    }
    try {
      const session = await readAdministratorSession(request, dependencies)
      if (!session) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const authorization = await dependencies.getAuthorization({
        authorizationId: body.data.authorizationId,
        hubSessionId: session.id,
      })
      if (!authorization || authorization.operation !== "END_ALL_HUB_SESSIONS") {
        response.status(409).json({ error: "The authorization could not be cancelled." })
        return
      }
      const cancelled = await dependencies.cancel({
        authorizationId: body.data.authorizationId,
        hubSessionId: session.id,
      })
      if (!cancelled) {
        response.status(409).json({ error: "The authorization could not be cancelled." })
        return
      }
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  }
}
