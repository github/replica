import type { RequestHandler } from "express"
import { z } from "zod"

import { hubSessionCookieName } from "../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../auth/types.ts"
import { readProductSession } from "../../../product/read-product-session/index.ts"
import { respondPublicSharingError } from "../../respond-public-sharing-error/index.ts"
import type { PublicSharingRouteDependencies } from "../../types.ts"

const bodySchema = z
  .object({
    operation: z.enum(["enable", "disable"]),
    confirmed: z.literal(true),
  })
  .strict()

export function patch(
  session: CurrentSessionDependencies,
  sharing: PublicSharingRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const cookie = readCookie(request, hubSessionCookieName)
      const initial = await readProductSession(cookie, session)
      if (!cookie || !initial) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      if (initial.role !== "ADMINISTRATOR") {
        response.status(403).json({ error: "Only Hub administrators can change public sharing." })
        return
      }
      const body = bodySchema.safeParse(request.body)
      if (!body.success) {
        response.status(422).json({ error: "Confirm whether to enable or disable public sharing." })
        return
      }
      const current = await readProductSession(cookie, session)
      if (
        !current ||
        current.membershipId !== initial.membershipId ||
        current.role !== "ADMINISTRATOR"
      ) {
        response.status(403).json({ error: "Only Hub administrators can change public sharing." })
        return
      }
      await sharing.changeSettings(body.data.operation)
      response.json({
        notice:
          body.data.operation === "enable"
            ? "Public sharing is enabled."
            : "Public sharing is disabled and existing links were revoked.",
      })
    } catch (error) {
      if (!respondPublicSharingError(response, error)) next(error)
    }
  }
}
