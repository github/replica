import type { RequestHandler } from "express"
import { z } from "zod"

import type { AdministratorRouteDependencies } from "../../../auth/types.ts"
import { readAdministratorSession } from "../../read-administrator-session/index.ts"

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    query: z.string().trim().min(1).max(100),
  })
  .strict()

export function get(dependencies: AdministratorRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    response.locals.omitLogPayload = true
    try {
      if (!(await readAdministratorSession(request, dependencies))) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const query = querySchema.safeParse(request.query)
      if (!query.success) {
        response.status(400).json({ error: "The administrator search query is invalid." })
        return
      }
      response.json({ candidates: await dependencies.search(query.data) })
    } catch (error) {
      next(error)
    }
  }
}
