import type { RequestHandler } from "express"
import { z } from "zod"

import { AdministratorAuthorizationDeniedError } from "../../../../../../domains/administrator-authorization/errors.ts"
import { browserAuthenticationCookieName } from "../../../../../../integrations/express/browser-authentication-cookie-name/index.ts"
import { createAuthenticationCookie } from "../../../../../../integrations/express/create-authentication-cookie/index.ts"
import type { CopilotConnectionRouteDependencies } from "../../../types.ts"
import { readSessionDigest } from "../../../read-session-digest/index.ts"

const bodySchema = z
  .object({
    confirmed: z.literal(true),
    operation: z.enum(["CONNECT_COPILOT", "DISCONNECT_COPILOT"]),
  })
  .strict()

export function post(dependencies: CopilotConnectionRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    response.locals.omitLogPayload = true
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
      const body = bodySchema.safeParse(request.body)
      if (!body.success) {
        response.status(400).json({ error: "Confirm the Copilot connection change explicitly." })
        return
      }
      if (!dependencies.authorization || !dependencies.getGeneration) {
        response.status(404).json({ error: "Copilot authorization is unavailable." })
        return
      }
      const state = await dependencies.status()
      if (body.data.operation === "DISCONNECT_COPILOT" && !state.savedConnection) {
        response.status(409).json({ error: "The Copilot connection changed. Review it again." })
        return
      }
      if (body.data.operation === "CONNECT_COPILOT" && !state.configured) {
        response.status(409).json({ error: "Hub has no configured Copilot token." })
        return
      }
      const provider =
        session.providerKey === "github"
          ? dependencies.authorization.start.github
          : session.providerKey === "entra"
            ? dependencies.authorization.start.entra
            : session.providerKey === "local"
              ? dependencies.authorization.start.local
              : undefined
      if (!provider) {
        response.status(409).json({ error: "The session authentication provider is unavailable." })
        return
      }
      const started = await provider.start({
        actorMembershipId: session.membershipId,
        expectedCopilotGeneration: await dependencies.getGeneration(),
        externalIdentityId: session.externalIdentityId,
        hubSessionId: session.id,
        operation: body.data.operation,
        targetMembershipIds: [session.membershipId],
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
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      next(error)
    }
  }
}
