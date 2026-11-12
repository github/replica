import type { RequestHandler } from "express"
import { z } from "zod"

import {
  CopilotConnectionDeniedError,
  CopilotConnectionUnavailableError,
} from "../../../../../../domains/copilot-connection/errors.ts"
import type { CopilotConnectionRouteDependencies } from "../../../../auth/types.ts"
import { readAdministratorSession } from "../../../../administrators/read-administrator-session/index.ts"

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
    try {
      const session = await readAdministratorSession(request, dependencies)
      if (!session) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const result = await dependencies.continue({
        authorizationId: body.data.authorizationId,
        hubSessionId: session.id,
        operation: body.data.operation,
      })
      response.json(result)
    } catch (error) {
      if (error instanceof CopilotConnectionDeniedError) {
        const message = {
          authorization_unavailable: "This Copilot authorization is no longer available.",
          connection_changed: "The Copilot connection changed. Review it before trying again.",
          no_token: "Hub has no configured Copilot token.",
          not_connected: "Copilot is not connected.",
          refused:
            "Copilot refused the configured token. Check its Copilot access and permissions.",
        }[error.reason]
        response.status(409).json({ error: message })
        return
      }
      if (error instanceof CopilotConnectionUnavailableError) {
        response.status(503).json({ error: "Copilot could not check the configured token." })
        return
      }
      next(error)
    }
  }
}
