import type { RequestHandler } from "express"
import { z } from "zod"

import { AdministratorAuthorizationDeniedError } from "../../../../../../domains/administrator-authorization/errors.ts"
import { browserAuthenticationCookieName } from "../../../../../../integrations/express/browser-authentication-cookie-name/index.ts"
import { createAuthenticationCookie } from "../../../../../../integrations/express/create-authentication-cookie/index.ts"
import type { SessionRevocationRouteDependencies } from "../../../../auth/types.ts"
import { readAdministratorSession } from "../../../../administrators/read-administrator-session/index.ts"

const bodySchema = z.object({ confirmed: z.literal(true) }).strict()

export function post(dependencies: SessionRevocationRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    response.locals.omitLogPayload = true
    try {
      const session = await readAdministratorSession(request, dependencies)
      if (!session) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      if (!bodySchema.safeParse(request.body).success) {
        response.status(400).json({ error: "Confirm that every Hub session will end." })
        return
      }
      const provider =
        session.providerKey === "github"
          ? dependencies.start.github
          : session.providerKey === "entra"
            ? dependencies.start.entra
            : undefined
      if (!provider) {
        response.status(409).json({ error: "The session authentication provider is unavailable." })
        return
      }
      const started = await provider.start({
        actorMembershipId: session.membershipId,
        externalIdentityId: session.externalIdentityId,
        hubSessionId: session.id,
        operation: "END_ALL_HUB_SESSIONS",
        targetMembershipIds: [],
      })
      response.setHeader(
        "Set-Cookie",
        createAuthenticationCookie({
          expiresAt: started.expiresAt,
          name: browserAuthenticationCookieName,
          secure: provider.secureCookie,
          value: started.browserBinding,
        }),
      )
      response.json({
        authorizationId: started.authorizationId,
        authorizationUrl: started.authorizationUrl,
        expiresAt: started.expiresAt.toISOString(),
      })
    } catch (error) {
      if (error instanceof AdministratorAuthorizationDeniedError) {
        response.status(403).json({ error: error.reason })
        return
      }
      next(error)
    }
  }
}
