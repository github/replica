import type { RequestHandler } from "express"
import { z } from "zod"

import { createBuildPreviewOrigin } from "../../../../../domains/build-preview/create-build-preview-origin/index.ts"
import { createSharePreviewGrant } from "../../../../../domains/public-sharing/create-share-preview-grant/index.ts"
import type { BuildPreviewRouteDependencies } from "../../../../build-preview/types.ts"
import type { PublicSharingRouteDependencies } from "../../types.ts"

export function get(
  sharing: PublicSharingRouteDependencies,
  preview: BuildPreviewRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const publicId = z.uuid().safeParse(request.params.shareId)
      const link = publicId.success ? await sharing.readPublicLink(publicId.data) : null
      response.setHeader("Cache-Control", "private, no-store")
      response.setHeader("Referrer-Policy", "no-referrer")
      if (!link || link.state !== "active") {
        response.status(404).end()
        return
      }
      const grant = createSharePreviewGrant(
        {
          buildId: link.buildId,
          shareLinkId: link.id,
          expiresAt: new Date(Date.now() + 2 * 60_000),
        },
        preview.encryptionKey,
      )
      const destination = new URL(
        "/__replica/share/authorize",
        createBuildPreviewOrigin(link.buildId, sharing.previewBaseOrigin),
      )
      destination.searchParams.set("grant", grant)
      response.redirect(302, destination.toString())
    } catch (error) {
      next(error)
    }
  }
}
