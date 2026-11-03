import type { RequestHandler } from "express"
import { z } from "zod"

import { startAuthentication } from "../../../../../../../integrations/express/start-authentication/index.ts"
import type { StartAdministratorEnrollmentDependencies } from "../../../../../authentication/types.ts"

const bodySchema = z
  .object({
    bootstrap_secret: z.string().min(1).max(2_000),
  })
  .strict()

export function post(dependencies: StartAdministratorEnrollmentDependencies): RequestHandler {
  const startEnrollment = startAuthentication(dependencies)
  return async (request, response, next) => {
    const body = bodySchema.safeParse(request.body)
    if (!body.success || !dependencies.verifyBootstrapSecret(body.data.bootstrap_secret)) {
      try {
        await dependencies.writeBootstrapDenial("invalid_secret")
      } catch (error) {
        next(error)
        return
      }
      if ((request.get("accept") ?? "").includes("text/html")) {
        response.redirect(303, "/admin-enrollment?authentication=denied")
        return
      }
      response.status(403).json({ error: "Administrator enrollment was denied." })
      return
    }
    startEnrollment(request, response, next)
  }
}
