import type { RequestHandler } from "express"
import { z } from "zod"

import { hubSessionCookieName } from "../../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../../auth/types.ts"
import { readProductSession } from "../../../../product/read-product-session/index.ts"
import type { ProductRouteDependencies } from "../../../../product/types.ts"

const querySchema = z
  .object({
    build: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
    view: z.enum(["gallery", "list", "minimized"]).optional(),
  })
  .strict()

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
      const prototypeId = z.uuid().safeParse(request.params.prototypeId)
      if (!repositoryId.success || !prototypeId.success) {
        response.status(400).json({ error: "Enter a valid prototype address." })
        return
      }

      const query = querySchema.safeParse(request.query)
      if (!query.success) {
        const status = Object.hasOwn(request.query, "build") ? 404 : 400
        response.status(status).json({
          error:
            status === 404 ? "Successful Build not found." : "The prototype request is invalid.",
        })
        return
      }
      const buildNumber = query.data.build ? Number(query.data.build) : undefined
      if (buildNumber !== undefined && !Number.isSafeInteger(buildNumber)) {
        response.status(404).json({ error: "Successful Build not found." })
        return
      }

      const detail = await product.findPrototypeDetail(
        initial,
        repositoryId.data,
        prototypeId.data,
        buildNumber,
      )
      const current = await readProductSession(cookie, session)
      if (!current || current.membershipId !== initial.membershipId) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      if (!detail || (buildNumber !== undefined && !detail.selectedBuild)) {
        response.status(404).json({ error: "Prototype or successful Build not found." })
        return
      }

      response.json({ ...detail, showPrototypeInfo: false })
    } catch (error) {
      next(error)
    }
  }
}
