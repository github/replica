import type { RequestHandler } from "express"
import { z } from "zod"

import { hubSessionCookieName } from "../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../auth/types.ts"
import { readProductSession } from "../../../product/read-product-session/index.ts"
import type { ProductRouteDependencies } from "../../../product/types.ts"

export function get(
  session: CurrentSessionDependencies,
  product: ProductRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const cookie = readCookie(request, hubSessionCookieName)
      const initial = await readProductSession(cookie, session)
      if (!initial) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      if (!repositoryId.success) {
        response.status(400).json({ error: "Enter a valid repository address." })
        return
      }
      if (request.query.q || request.query.author || request.query.page) {
        response.status(400).json({ error: "Prototype filters are not available yet." })
        return
      }
      const index = await product.findRepositoryIndex(repositoryId.data)
      const current = await readProductSession(cookie, session)
      if (!current || current.membershipId !== initial.membershipId) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      if (!index) {
        response.status(404).json({ error: "Repository not found." })
        return
      }
      response.json(index)
    } catch (error) {
      next(error)
    }
  }
}
