import type { RequestHandler } from "express"
import { z } from "zod"

import { redirectAuthenticationStart } from "../../../../../integrations/express/redirect-authentication-start/index.ts"
import type { StartAuthenticationDependencies } from "../../types.ts"

const bodySchema = z.object({ switch_account: z.literal("true").optional() }).strict()

export function post(dependencies: StartAuthenticationDependencies): RequestHandler {
  return async (request, response, next) => {
    const contentType = request.get("content-type")
    if (
      (contentType &&
        contentType.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/x-www-form-urlencoded") ||
      (!contentType &&
        (request.get("transfer-encoding") || Number(request.get("content-length")) > 0))
    ) {
      response.status(415).json({ error: "Submit the sign-in form using form encoding." })
      return
    }
    const body = bodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      response.status(400).json({ error: "Choose a valid sign-in option." })
      return
    }
    try {
      redirectAuthenticationStart(
        response,
        dependencies.secureCookie,
        await dependencies.start({ switchAccount: body.data.switch_account === "true" }),
      )
    } catch (error) {
      next(error)
    }
  }
}
