import type { RequestHandler } from "express"
import { z } from "zod"

import { AdministratorManagementDeniedError } from "../../../../../../domains/administrator-management/errors.ts"
import { AdministratorAuthorizationDeniedError } from "../../../../../../domains/administrator-authorization/errors.ts"
import type { AdministratorRouteDependencies } from "../../../../auth/types.ts"
import { readAdministratorSession } from "../../../read-administrator-session/index.ts"

const bodySchema = z
  .object({
    authorizationId: z.uuid(),
    operation: z.enum(["DESIGNATE_ADMINISTRATORS", "REVOKE_ADMINISTRATOR"]),
    targetMembershipIds: z.array(z.uuid()).min(1).max(50),
  })
  .strict()

export function post(dependencies: AdministratorRouteDependencies): RequestHandler {
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
        operation: body.data.operation,
        targetMembershipIds: body.data.targetMembershipIds,
      })
      response.json({ result })
    } catch (error) {
      if (
        error instanceof AdministratorAuthorizationDeniedError ||
        error instanceof AdministratorManagementDeniedError
      ) {
        response.status(409).json({ error: error.reason })
        return
      }
      next(error)
    }
  }
}
