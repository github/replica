import type { RequestHandler } from "express"
import { z } from "zod"

import { reserveBuildPreviewBytes } from "../../../../../../../domains/build-preview/reserve-build-preview-bytes/index.ts"
import { trackResponseReservations } from "../../../../../../../integrations/express/track-response-reservations/index.ts"
import { readHubSessionCookie } from "../../../../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../../../auth/types.ts"
import { readProductSession } from "../../../../../product/read-product-session/index.ts"
import { readProductWithCurrentAuthority } from "../../../../../product/read-product-with-current-authority/index.ts"
import type { ProductRouteDependencies } from "../../../../../product/types.ts"

const sizeSchema = z.enum(["desktop", "narrow"])

/** Serves a Build's stored screenshot from the Hub origin to members who can see it. */
export function get(
  session: CurrentSessionDependencies,
  product: ProductRouteDependencies,
  readBuildArtifact: NonNullable<ProductRouteDependencies["readBuildArtifact"]>,
): RequestHandler {
  return async (request, response, next) => {
    const reservations = trackResponseReservations(response, reserveBuildPreviewBytes)
    function reserveBytes(byteLength: number) {
      return Boolean(reservations.reserve(byteLength))
    }
    try {
      const cookie = readHubSessionCookie(request)
      const initial = await readProductSession(cookie, session)
      if (!cookie || !initial) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      const prototypeId = z.uuid().safeParse(request.params.prototypeId)
      const buildNumber = z.coerce.number().int().positive().safeParse(request.params.buildNumber)
      const size = sizeSchema.safeParse(request.params.size)
      if (!repositoryId.success || !prototypeId.success || !buildNumber.success || !size.success) {
        response.status(400).json({ error: "Enter a valid Build screenshot address." })
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
            size.data,
          )
          if (!target || !(await product.isRepositoryVisible(viewer, repositoryId.data)))
            return null
          return readBuildArtifact(target.buildId, target.artifactPath, reserveBytes)
        },
      )
      if (response.destroyed) return
      if (!read) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const stored = read.result
      if (stored?.status === "unavailable") {
        response.status(503).json({ error: "The Build screenshot is temporarily unavailable." })
        return
      }
      // Access can be revoked while storage is read, without ending the session.
      if (
        stored?.status !== "ok" ||
        !(await product.isRepositoryVisible(read.current, repositoryId.data))
      ) {
        response.status(404).json({ error: "Build screenshot not found." })
        return
      }
      if (response.destroyed) return
      response.setHeader("Cache-Control", "private, no-store")
      response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
      response.setHeader(
        "Content-Disposition",
        `inline; filename="build-${buildNumber.data}-${size.data}.png"`,
      )
      response.setHeader("Cross-Origin-Resource-Policy", "same-origin")
      response.setHeader("X-Content-Type-Options", "nosniff")
      response.setHeader("Content-Type", "image/png")
      response.setHeader("Content-Length", stored.bytes.byteLength)
      response.end(stored.bytes)
    } catch (error) {
      next(error)
    } finally {
      reservations.settle()
    }
  }
}
