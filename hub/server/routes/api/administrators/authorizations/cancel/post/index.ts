import type { RequestHandler } from "express"
import { z } from "zod"

import type { AdministratorRouteDependencies } from "../../../../auth/types.ts"
import { readAdministratorSession } from "../../../read-administrator-session/index.ts"

const bodySchema = z.object({ authorizationId: z.uuid() }).strict()

export function post(dependencies: AdministratorRouteDependencies): RequestHandler {
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
      if (
        !(await dependencies.cancel({
          authorizationId: body.data.authorizationId,
          hubSessionId: session.id,
        }))
      ) {
        response.status(409).json({ error: "The authorization is no longer available." })
        return
      }
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  }
}
