import type { RequestHandler } from "express"
import { z } from "zod"

import { hubSessionCookieName } from "../../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../../auth/types.ts"
import { readProductSession } from "../../../../product/read-product-session/index.ts"
import { readProductWithCurrentAuthority } from "../../../../product/read-product-with-current-authority/index.ts"
import type { ProductRouteDependencies } from "../../../../product/types.ts"

const pageSize = 25
const querySchema = z
  .object({
    page: z
      .string()
      .regex(/^[1-9]\d{0,8}$/)
      .optional(),
    build: z
      .string()
      .regex(/^[1-9]\d{0,9}$/)
      .transform(Number)
      .pipe(z.int().max(2147483647))
      .optional(),
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
        response.status(400).json({ error: "The Build history request is invalid." })
        return
      }

      const page = Number(query.data.page ?? "1")
      const read = await readProductWithCurrentAuthority(initial, cookie, session, (viewer) =>
        product.findPrototypeDetail(viewer, repositoryId.data, prototypeId.data, query.data.build, {
          page,
          pageSize,
        }),
      )
      if (!read) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const detail = read.result
      if (!detail) {
        response.status(404).json({ error: "Prototype not found." })
        return
      }

      if (!detail.buildPage) throw new Error("Build history was not loaded.")
      const { builds, totalCount } = detail.buildPage
      const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
      if (page > pageCount) {
        response.status(404).json({ error: "Page not found." })
        return
      }
      response.json({
        repository: detail.repository,
        prototype: { ...detail.prototype, canEdit: true },
        builds,
        pagination: { page, pageSize, totalCount, pageCount },
      })
    } catch (error) {
      next(error)
    }
  }
}
