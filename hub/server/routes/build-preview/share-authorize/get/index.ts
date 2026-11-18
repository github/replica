import type { RequestHandler } from "express"

import { createSharePreviewSession } from "../../../../domains/public-sharing/create-share-preview-session/index.ts"
import { readSharePreviewGrant } from "../../../../domains/public-sharing/read-share-preview-grant/index.ts"
import { readPreviewBuildId } from "../../../../domains/build-preview/read-preview-build-id/index.ts"
import { createSharePreviewCookie } from "../../../../integrations/express/create-share-preview-cookie/index.ts"
import { normalizeStartPage } from "../../../../utils/normalize-start-page/index.ts"
import type { PublicSharingRouteDependencies } from "../../../api/public-sharing/types.ts"
import type { BuildPreviewRouteDependencies } from "../../types.ts"

export function get(
  preview: BuildPreviewRouteDependencies,
  sharing: PublicSharingRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const buildId = readPreviewBuildId(request.get("host"), preview.previewBaseOrigin)
      const value = typeof request.query.grant === "string" ? request.query.grant : ""
      const grant = readSharePreviewGrant(value, preview.encryptionKey)
      if (!buildId || !grant || grant.b !== buildId) {
        response.status(404).end()
        return
      }
      const link = await sharing.readAvailableLink(grant.s, grant.b)
      if (!link) {
        response.status(404).end()
        return
      }
      const expiresAt = new Date(Math.min(Date.now() + 8 * 60 * 60_000, link.expiresAt.getTime()))
      response.setHeader(
        "Set-Cookie",
        createSharePreviewCookie({
          value: createSharePreviewSession(
            { buildId: grant.b, shareLinkId: grant.s, expiresAt },
            preview.encryptionKey,
          ),
          expiresAt,
          secure:
            new URL(preview.previewBaseOrigin).protocol === "https:" ||
            new URL(preview.previewBaseOrigin).hostname.endsWith(".localhost"),
        }),
      )
      response.setHeader("Cache-Control", "private, no-store")
      response.setHeader("Referrer-Policy", "no-referrer")
      response.redirect(303, normalizeStartPage(link.startPage) ?? "/")
    } catch (error) {
      next(error)
    }
  }
}
