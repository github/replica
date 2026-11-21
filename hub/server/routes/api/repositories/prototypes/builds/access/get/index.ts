import type { RequestHandler } from "express"
import { z } from "zod"

import { hubSessionCookieName } from "../../../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../../../auth/types.ts"
import { readProductSession } from "../../../../../product/read-product-session/index.ts"
import { readProductWithCurrentAuthority } from "../../../../../product/read-product-with-current-authority/index.ts"
import { normalizeStartPage } from "../../../../../../../utils/normalize-start-page/index.ts"
import type { ProductRouteDependencies } from "../../../../../product/types.ts"
import type { BuildPreviewRouteDependencies } from "../../../../../../build-preview/types.ts"

const querySchema = z
  .object({
    target: z.enum(["preview", "desktop", "narrow"]),
    route: z.string().max(4096).optional(),
  })
  .strict()

export function get(
  session: CurrentSessionDependencies,
  product: ProductRouteDependencies,
  preview: BuildPreviewRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const cookie = readCookie(request, hubSessionCookieName)
      const initial = await readProductSession(cookie, session)
      if (!cookie || !initial) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      const prototypeId = z.uuid().safeParse(request.params.prototypeId)
      const buildNumber = z.coerce.number().int().positive().safeParse(request.params.buildNumber)
      const query = querySchema.safeParse(request.query)
      if (!repositoryId.success || !prototypeId.success || !buildNumber.success || !query.success) {
        response.status(400).json({ error: "Enter a valid Build preview address." })
        return
      }
      const read = await readProductWithCurrentAuthority(
        initial,
        cookie,
        session,
        async (viewer) => {
          if (!(await product.isRepositoryVisible(viewer, repositoryId.data))) return null
          const target = await product.findBuildPreviewTarget(
            repositoryId.data,
            prototypeId.data,
            buildNumber.data,
            query.data.target,
          )
          return target && (await product.isRepositoryVisible(viewer, repositoryId.data))
            ? target
            : null
        },
      )
      if (!read) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const target = read.result
      if (!target || !(await product.isRepositoryVisible(read.current, repositoryId.data))) {
        response.status(404).json({ error: "Build preview not found." })
        return
      }
      const requestedRoute = query.data.route ? normalizeStartPage(query.data.route) : undefined
      if (query.data.route && !requestedRoute) {
        response.status(400).json({ error: "The Build preview route is invalid." })
        return
      }
      if (!target.mountPath) {
        response.status(404).json({ error: "This Build has no supported hosted preview address." })
        return
      }
      const path =
        query.data.target === "preview"
          ? (requestedRoute ?? normalizeStartPage(target.startPage) ?? "/")
          : `/__replica/screenshots/${query.data.target}.png`
      response.setHeader("Cache-Control", "no-store")
      response.setHeader("Referrer-Policy", "no-referrer")
      response.redirect(
        302,
        new URL(`${target.mountPath}${path.slice(1)}`, preview.applicationOrigin).toString(),
      )
    } catch (error) {
      next(error)
    }
  }
}
