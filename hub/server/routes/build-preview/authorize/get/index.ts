import type { RequestHandler } from "express"
import { z } from "zod"

import { createPreviewSession } from "../../../../domains/build-preview/create-preview-session/index.ts"
import { readPreviewBuildId } from "../../../../domains/build-preview/read-preview-build-id/index.ts"
import { readPreviewGrant } from "../../../../domains/build-preview/read-preview-grant/index.ts"
import { resolveBuildPreviewLaunch } from "../../../../domains/build-preview/resolve-build-preview-launch/index.ts"
import { createPreviewCookie } from "../../../../integrations/express/create-preview-cookie/index.ts"
import { normalizeStartPage } from "../../../../utils/normalize-start-page/index.ts"
import type { BuildPreviewRouteDependencies } from "../../types.ts"

export function get(dependencies: BuildPreviewRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const buildId = readPreviewBuildId(request.get("host"), dependencies.previewBaseOrigin)
      const grantValue = typeof request.query.grant === "string" ? request.query.grant : ""
      const requestedRoute = z.string().max(4096).safeParse(request.query.route)
      const grant = readPreviewGrant(grantValue, dependencies.encryptionKey)
      const normalizedRoute = requestedRoute.success
        ? normalizeStartPage(requestedRoute.data)
        : null
      if (!buildId || !grant || grant.buildId !== buildId) {
        response.status(404).end()
        return
      }
      if (request.query.route !== undefined && !normalizedRoute) {
        response.status(404).end()
        return
      }
      const documentLaunch =
        !grant.screenshotPath && (grant.target === "preview" || grant.target === "template")
      if (documentLaunch && !(await dependencies.restoreSession?.(grant.sessionDigest))) {
        response.status(404).end()
        return
      }
      const target = await dependencies.findTargetById(buildId, grant.target)
      if (
        !target ||
        (grant.screenshotPath && !(await dependencies.findArtifact(buildId, grant.screenshotPath)))
      ) {
        response.status(404).end()
        return
      }
      response.setHeader("Cache-Control", "no-store")
      response.setHeader("Referrer-Policy", "no-referrer")
      let destination: string
      if (grant.screenshotPath) {
        destination = `/__replica/${grant.screenshotPath}`
      } else if (documentLaunch) {
        const page = normalizedRoute ?? normalizeStartPage(target.startPage) ?? "/"
        const launch = await resolveBuildPreviewLaunch(buildId, page, dependencies)
        if (
          !(await dependencies.findTargetById(buildId, grant.target)) ||
          !(await dependencies.restoreSession?.(grant.sessionDigest)) ||
          grant.expiresAt.getTime() <= Date.now()
        ) {
          response.status(404).end()
          return
        }
        if (launch.status === "unavailable") {
          response.status(503).end()
          return
        }
        destination = launch.destination
      } else {
        destination = `/__replica/screenshots/${grant.target}.png`
      }

      const expiresAt = new Date(Date.now() + 15 * 60_000)
      response.setHeader(
        "Set-Cookie",
        createPreviewCookie({
          value: createPreviewSession(
            buildId,
            grant.sessionDigest,
            expiresAt,
            dependencies.encryptionKey,
            grant.target === "template",
          ),
          expiresAt,
          secure:
            new URL(dependencies.previewBaseOrigin).protocol === "https:" ||
            new URL(dependencies.previewBaseOrigin).hostname.endsWith(".localhost"),
        }),
      )
      response.redirect(303, destination)
    } catch (error) {
      next(error)
    }
  }
}
