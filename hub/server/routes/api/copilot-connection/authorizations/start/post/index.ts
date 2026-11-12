import type { RequestHandler } from "express"
import { z } from "zod"

import { AdministratorAuthorizationDeniedError } from "../../../../../../domains/administrator-authorization/errors.ts"
import { browserAuthenticationCookieName } from "../../../../../../integrations/express/browser-authentication-cookie-name/index.ts"
import { createAuthenticationCookie } from "../../../../../../integrations/express/create-authentication-cookie/index.ts"
import type { CopilotConnectionRouteDependencies } from "../../../../auth/types.ts"
import { readAdministratorSession } from "../../../../administrators/read-administrator-session/index.ts"

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
      const session = await readAdministratorSession(request, dependencies)
      if (!session) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const body = bodySchema.safeParse(request.body)
      if (!body.success) {
        response.status(400).json({ error: "Confirm the Copilot connection change explicitly." })
        return
      }
      const state = await dependencies.getState()
      if (
        (body.data.operation === "CONNECT_COPILOT" &&
          state.connected &&
          !state.refusedAt &&
          !state.tokenNeedsCheck) ||
        (body.data.operation === "DISCONNECT_COPILOT" && !state.connected)
      ) {
        response.status(409).json({ error: "The Copilot connection changed. Review it again." })
        return
      }
      if (body.data.operation === "CONNECT_COPILOT" && !dependencies.tokenConfigured) {
        response.status(409).json({ error: "Hub has no configured Copilot token." })
        return
      }
      const provider =
        session.providerKey === "github"
          ? dependencies.start.github
          : session.providerKey === "entra"
            ? dependencies.start.entra
            : session.providerKey === "local"
              ? dependencies.start.local
              : undefined
      if (!provider) {
        response.status(409).json({ error: "The session authentication provider is unavailable." })
        return
      }
      const started = await provider.start({
        actorMembershipId: session.membershipId,
        expectedCopilotGeneration: state.generation,
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
