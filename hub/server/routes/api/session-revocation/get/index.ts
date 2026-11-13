import type { RequestHandler } from "express"

import type { SessionRevocationRouteDependencies } from "../../auth/types.ts"
import { readAdministratorSession } from "../../administrators/read-administrator-session/index.ts"

export function get(dependencies: SessionRevocationRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const session = await readAdministratorSession(request, dependencies)
      if (!session) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const status = await dependencies.getStatus()
      if (!status) {
        response.status(503).json({ error: "Session revocation authority is unavailable." })
        return
      }
      response.json({ status })
    } catch (error) {
      next(error)
    }
  }
}
