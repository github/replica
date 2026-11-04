import type { RequestHandler } from "express"
import { z } from "zod"

import { redirectAuthenticationStart } from "../../../../../../../integrations/express/redirect-authentication-start/index.ts"
import type { StartAdministratorEnrollmentDependencies } from "../../../../types.ts"

const bodySchema = z
  .object({
    bootstrap_secret: z.string().min(1).max(2_000),
  })
  .strict()

export function post(dependencies: StartAdministratorEnrollmentDependencies): RequestHandler {
  return async (request, response, next) => {
    const body = bodySchema.safeParse(request.body)
    if (!body.success || !dependencies.verifyBootstrapSecret(body.data.bootstrap_secret)) {
      try {
        await dependencies.writeBootstrapDenial("invalid_secret")
      } catch (error) {
        next(error)
        return
      }
      response.redirect(303, "/admin-enrollment?authentication=denied")
      return
    }
    try {
      redirectAuthenticationStart(response, dependencies.secureCookie, await dependencies.start())
    } catch (error) {
      next(error)
    }
  }
}
