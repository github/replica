import type { RequestHandler } from "express"
import { z } from "zod"

import type { CopilotConnectionRouteDependencies } from "../../../types.ts"
import { readSessionDigest } from "../../../read-session-digest/index.ts"

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
      const sessionDigest = readSessionDigest(request)
      const session =
        sessionDigest && dependencies.authorization
          ? await dependencies.authorization.findSession(sessionDigest)
          : null
      if (!session) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      if (!dependencies.authorization) {
        response.status(404).json({ error: "Copilot authorization is unavailable." })
        return
      }
      const cancelled = await dependencies.authorization.cancel({
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
