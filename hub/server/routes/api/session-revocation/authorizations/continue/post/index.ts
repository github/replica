import type { RequestHandler } from "express"
import { z } from "zod"

import { SessionRevocationDeniedError } from "../../../../../../domains/session-revocation/errors.ts"
import { clearAuthenticationCookie } from "../../../../../../integrations/express/clear-authentication-cookie/index.ts"
import { hubSessionCookieName } from "../../../../../../integrations/express/hub-session-cookie-name/index.ts"
import type { SessionRevocationRouteDependencies } from "../../../../auth/types.ts"
import { readAdministratorSession } from "../../../../administrators/read-administrator-session/index.ts"

const bodySchema = z.object({ authorizationId: z.uuid() }).strict()

export function post(dependencies: SessionRevocationRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    response.locals.omitLogPayload = true
    const body = bodySchema.safeParse(request.body)
    if (!body.success) {
      response.status(400).json({ error: "The authorization continuation is invalid." })
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
      })
      response.setHeader(
        "Set-Cookie",
        clearAuthenticationCookie(hubSessionCookieName, dependencies.secureCookie),
      )
      response.json({ result })
    } catch (error) {
      if (error instanceof SessionRevocationDeniedError) {
        response.status(409).json({ error: error.reason })
        return
      }
      next(error)
    }
  }
}
