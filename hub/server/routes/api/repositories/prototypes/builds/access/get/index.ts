import type { RequestHandler } from "express"
import { z } from "zod"

import { createBuildPreviewOrigin } from "../../../../../../../domains/build-preview/create-build-preview-origin/index.ts"
import { createPreviewGrant } from "../../../../../../../domains/build-preview/create-preview-grant/index.ts"
import { hashAuthenticationValue } from "../../../../../../../domains/authentication/hash-authentication-value/index.ts"
import { hubSessionCookieName } from "../../../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../../../auth/types.ts"
import { readProductSession } from "../../../../../product/read-product-session/index.ts"
import { normalizeStartPage } from "../../../../../../../utils/normalize-start-page/index.ts"
import type { ProductRouteDependencies } from "../../../../../product/types.ts"
import type { BuildPreviewRouteDependencies } from "../../../../../../build-preview/types.ts"

const querySchema = z
  .object({
    target: z.enum(["preview", "desktop", "narrow"]),
    preview_origin: z.url().optional(),
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
      const target = await product.findBuildPreviewTarget(
        repositoryId.data,
        prototypeId.data,
        buildNumber.data,
        query.data.target,
      )
      const current = await readProductSession(cookie, session)
      if (
        !current ||
        current.membershipId !== initial.membershipId ||
        current.userId !== initial.userId
      ) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      if (!target) {
        response.status(404).json({ error: "Build preview not found." })
        return
      }
      const previewOrigin = createBuildPreviewOrigin(target.buildId, preview.previewBaseOrigin)
      if (query.data.preview_origin && query.data.preview_origin !== previewOrigin) {
        response.status(400).json({ error: "The Build preview origin is invalid." })
        return
      }
      const requestedRoute = query.data.route ? normalizeStartPage(query.data.route) : undefined
      if (query.data.route && !requestedRoute) {
        response.status(400).json({ error: "The Build preview route is invalid." })
        return
      }
      const grant = createPreviewGrant(
        {
          buildId: target.buildId,
          target: query.data.target,
          expiresAt: new Date(Date.now() + 30_000),
          sessionDigest: hashAuthenticationValue(cookie),
        },
        preview.encryptionKey,
      )
      const destination = new URL("/__replica/authorize", previewOrigin)
      destination.searchParams.set("grant", grant)
      if (query.data.target === "preview" && requestedRoute) {
        destination.searchParams.set("route", requestedRoute)
      }
      response.setHeader("Cache-Control", "no-store")
      response.setHeader("Referrer-Policy", "no-referrer")
      response.redirect(302, destination.toString())
    } catch (error) {
      next(error)
    }
  }
}
