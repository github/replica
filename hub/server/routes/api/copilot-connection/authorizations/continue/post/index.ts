import type { RequestHandler } from "express"
import { z } from "zod"

import { CopilotConnectionError } from "../../../../../../domains/copilot-connection/errors.ts"
import type { CopilotConnectionRouteDependencies } from "../../../types.ts"
import { readSessionDigest } from "../../../read-session-digest/index.ts"

const bodySchema = z
  .object({
    authorizationId: z.uuid(),
    operation: z.enum(["CONNECT_COPILOT", "DISCONNECT_COPILOT"]),
  })
  .strict()

export function post(dependencies: CopilotConnectionRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    response.locals.omitLogPayload = true
    const body = bodySchema.safeParse(request.body)
    if (!body.success) {
      response.status(400).json({ error: "The Copilot authorization continuation is invalid." })
      return
    }
    const sessionDigest = readSessionDigest(request)
    const session =
      sessionDigest && dependencies.authorization && dependencies.continueAuthorization
        ? await dependencies.authorization.findSession(sessionDigest)
        : null
    if (!sessionDigest || !session || !dependencies.continueAuthorization) {
      response.status(403).json({ error: "Administrator access is required." })
      return
    }
    try {
      const result = await dependencies.continueAuthorization({
        authorizationId: body.data.authorizationId,
        hubSessionId: session.id,
        operation: body.data.operation,
        sessionDigest,
        signal: request.signal,
      })
      response.json(result)
    } catch (error) {
      if (error instanceof CopilotConnectionError) {
        response.status(error.code === "unavailable" ? 503 : 409).json({ error: error.message })
        return
      }
      next(error)
    }
  }
}
