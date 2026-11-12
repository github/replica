import type { RequestHandler } from "express"
import { z } from "zod"

import type { CopilotConnectionRouteDependencies } from "../../../../auth/types.ts"
import { readAdministratorSession } from "../../../../administrators/read-administrator-session/index.ts"

const bodySchema = z.object({ authorizationId: z.uuid() }).strict()

export function post(dependencies: CopilotConnectionRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    response.locals.omitLogPayload = true
    const body = bodySchema.safeParse(request.body)
    if (!body.success) {
      response.status(400).json({ error: "The Copilot authorization cancellation is invalid." })
      return
    }
    try {
      const session = await readAdministratorSession(request, dependencies)
      if (!session) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const cancelled = await dependencies.cancel({
        authorizationId: body.data.authorizationId,
        hubSessionId: session.id,
      })
      if (!cancelled) {
        response.status(410).json({ error: "This Copilot authorization is unavailable." })
        return
      }
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  }
}
