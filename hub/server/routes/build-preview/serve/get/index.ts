import type { RequestHandler } from "express"

import { readBuildPreviewFile } from "../../../../domains/build-preview/read-build-preview-file/index.ts"
import { readPreviewBuildId } from "../../../../domains/build-preview/read-preview-build-id/index.ts"
import { readPreviewSession } from "../../../../domains/build-preview/read-preview-session/index.ts"
import { readSharePreviewSession } from "../../../../domains/public-sharing/read-share-preview-session/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import type { BuildPreviewRouteDependencies } from "../../types.ts"

function setSecurityHeaders(
  response: Parameters<RequestHandler>[1],
  applicationOrigin: string,
  sharedScreenshot: boolean,
) {
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
  response.setHeader(
    "Cross-Origin-Resource-Policy",
    sharedScreenshot ? "cross-origin" : "same-origin",
  )
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  response.setHeader("Referrer-Policy", "no-referrer")
  response.setHeader("X-Content-Type-Options", "nosniff")
}

export function get(dependencies: BuildPreviewRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const buildId = readPreviewBuildId(request, dependencies.previewBaseOrigin)
      if (!buildId) {
        next()
        return
      }
      const sessionValue = readCookie(request, "replica_preview")
      const authenticated =
        sessionValue && readPreviewSession(sessionValue, buildId, dependencies.encryptionKey)
      const shareValue = readCookie(request, "replica_share_preview")
      const shareSession =
        shareValue && readSharePreviewSession(shareValue, buildId, dependencies.encryptionKey)
      const publicLink =
        !authenticated && shareSession && dependencies.readAvailableShareLink
          ? await dependencies.readAvailableShareLink(shareSession.s, buildId)
          : null
      const privateAuthorized =
        authenticated &&
        dependencies.restoreSession &&
        (await dependencies.restoreSession(authenticated.s)) &&
        (await dependencies.findTargetById(buildId, "preview"))
      if (!privateAuthorized && !publicLink) {
        response.status(404).end()
        return
      }
      const screenshot =
        request.path === "/__replica/screenshots/desktop.png" ||
        request.path === "/__replica/screenshots/narrow.png"
      setSecurityHeaders(
        response,
        dependencies.applicationOrigin,
        Boolean(privateAuthorized && screenshot),
      )

      if (request.path === "/__replica/bridge/v1.js") {
        const reviewSource = (dependencies.reviewBridgeSource ?? "")
          .replace('"__REPLICA_HUB_ORIGIN__"', JSON.stringify(dependencies.applicationOrigin))
          .replace(
            '"__REPLICA_REVIEW_ENABLED__"',
            JSON.stringify(String(Boolean(privateAuthorized))),
          )
        const source = `${reviewSource}\n${dependencies.bridgeSource};ReplicaHostedPreviewBridge.installHostedBridge(${JSON.stringify(dependencies.applicationOrigin)});`
        response.setHeader(
          "Cache-Control",
          publicLink ? "private, no-store" : "private, max-age=300",
        )
        response.type("text/javascript").send(source)
        return
      }

      const file = await readBuildPreviewFile(
        {
          acceptsHtml: Boolean(request.accepts("html")),
          buildId,
          requestPath: request.path,
        },
        dependencies,
      )
      if (file.status !== "ok") {
        response.status(file.status === "not-found" ? 404 : 503).end()
        return
      }
      if (
        !privateAuthorized &&
        shareSession &&
        (!dependencies.readAvailableShareLink ||
          !(await dependencies.readAvailableShareLink(shareSession.s, buildId)))
      ) {
        response.status(404).end()
        return
      }
      if (
        privateAuthorized &&
        (!authenticated ||
          !dependencies.restoreSession ||
          !(await dependencies.restoreSession(authenticated.s)) ||
          !(await dependencies.findTargetById(buildId, "preview")))
      ) {
        response.status(404).end()
        return
      }
      response.setHeader(
        "Cache-Control",
        publicLink
          ? "private, no-store"
          : file.html
            ? "private, no-cache"
            : "private, max-age=31536000, immutable",
      )
      response.setHeader("Content-Type", file.contentType)
      response.setHeader("Content-Length", file.bytes.byteLength)
      response.end(file.bytes)
    } catch (error) {
      next(error)
    }
  }
}
