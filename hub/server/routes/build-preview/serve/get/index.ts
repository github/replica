import type { RequestHandler } from "express"

import { readBuildPreviewFile } from "../../../../domains/build-preview/read-build-preview-file/index.ts"
import { readPreviewBuildId } from "../../../../domains/build-preview/read-preview-build-id/index.ts"
import { readTemplateScreenshotPath } from "../../../../domains/build-preview/template-screenshot-path/index.ts"
import { readSharePreviewSession } from "../../../../domains/public-sharing/read-share-preview-session/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import type { BuildPreviewRouteDependencies } from "../../types.ts"
import { createPreviewResponseReservation } from "../../create-preview-response-reservation/index.ts"

function setSecurityHeaders(response: Parameters<RequestHandler>[1], applicationOrigin: string) {
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self' data: blob:",
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      `frame-ancestors ${applicationOrigin}`,
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  )
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin")
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  response.setHeader("Referrer-Policy", "no-referrer")
  response.setHeader("X-Content-Type-Options", "nosniff")
}

export function get(dependencies: BuildPreviewRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    const admission = createPreviewResponseReservation(response)
    try {
      if (!dependencies.previewBaseOrigin) {
        next()
        return
      }
      const buildId = readPreviewBuildId(request.get("host"), dependencies.previewBaseOrigin)
      if (!buildId) {
        next()
        return
      }
      const shareValue = readCookie(request, "replica_share_preview")
      const shareSession =
        shareValue && readSharePreviewSession(shareValue, buildId, dependencies.encryptionKey)
      const publicLink =
        shareSession && dependencies.readAvailableShareLink
          ? await dependencies.readAvailableShareLink(shareSession.s, buildId)
          : null
      if (!publicLink) {
        response.status(404).end()
        return
      }
      const templateScreenshot = readTemplateScreenshotPath(request.path)
      if (templateScreenshot && templateScreenshot !== "screenshots/desktop.png") {
        response.status(404).end()
        return
      }
      setSecurityHeaders(response, dependencies.applicationOrigin)

      if (request.path === "/__replica/bridge/v1.js") {
        const reviewSource = (dependencies.reviewBridgeSource ?? "")
          .replaceAll('"__REPLICA_HUB_ORIGIN__"', JSON.stringify(dependencies.applicationOrigin))
          .replaceAll('"__REPLICA_REVIEW_ENABLED__"', JSON.stringify("false"))
        const source = `${reviewSource}\n${dependencies.bridgeSource};ReplicaHostedPreviewBridge.installHostedBridge(${JSON.stringify(dependencies.applicationOrigin)});`
        response.setHeader("Cache-Control", "private, no-store")
        response.type("text/javascript").send(source)
        return
      }

      const file = await readBuildPreviewFile(
        {
          acceptsHtml: Boolean(request.accepts("html")),
          buildId,
          distOnly: publicLink.hosted,
          requestPath: request.path,
        },
        {
          ...dependencies,
          reserveBytes: admission.reserveBytes,
        },
      )
      if (response.destroyed) return
      if (file.status !== "ok") {
        response.status(file.status === "not-found" ? 404 : 503).end()
        return
      }
      if (
        shareSession &&
        (!dependencies.readAvailableShareLink ||
          !(await dependencies.readAvailableShareLink(shareSession.s, buildId)))
      ) {
        response.status(404).end()
        return
      }
      response.setHeader("Cache-Control", "private, no-store")
      response.setHeader("Content-Type", file.contentType)
      response.setHeader("Content-Length", file.bytes.byteLength)
      response.end(file.bytes)
    } catch (error) {
      next(error)
    } finally {
      admission.completeRequest()
    }
  }
}
