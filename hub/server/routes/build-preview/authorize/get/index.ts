import type { RequestHandler } from "express"

import { createPreviewSession } from "../../../../domains/build-preview/create-preview-session/index.ts"
import { readPreviewBuildId } from "../../../../domains/build-preview/read-preview-build-id/index.ts"
import { readPreviewGrant } from "../../../../domains/build-preview/read-preview-grant/index.ts"
import { normalizeStartPage } from "../../../../utils/normalize-start-page/index.ts"
import { createPreviewCookie } from "../../../../integrations/express/create-preview-cookie/index.ts"
import type { BuildPreviewRouteDependencies } from "../../types.ts"

export function get(dependencies: BuildPreviewRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const buildId = readPreviewBuildId(request, dependencies.previewBaseOrigin)
      const grantValue = typeof request.query.grant === "string" ? request.query.grant : ""
      const grant = readPreviewGrant(grantValue, dependencies.encryptionKey)
      if (!buildId || !grant || grant.buildId !== buildId) {
        response.status(404).end()
        return
      }
      const target = await dependencies.findTargetById(buildId, grant.target)
      if (!target) {
        response.status(404).end()
        return
      }
      const expiresAt = new Date(Date.now() + 15 * 60_000)
      response.setHeader(
        "Set-Cookie",
        createPreviewCookie({
          value: createPreviewSession(buildId, expiresAt, dependencies.encryptionKey),
          expiresAt,
          secure:
            new URL(dependencies.previewBaseOrigin).protocol === "https:" ||
            new URL(dependencies.previewBaseOrigin).hostname.endsWith(".localhost"),
        }),
      )
      response.setHeader("Cache-Control", "no-store")
      response.setHeader("Referrer-Policy", "no-referrer")
      const destination =
        grant.target === "preview"
          ? (normalizeStartPage(target.startPage) ?? "/")
          : `/__replica/screenshots/${grant.target}.png`
      response.redirect(303, destination)
    } catch (error) {
      next(error)
    }
  }
}
