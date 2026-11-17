import type { RequestHandler } from "express"

import { readBuildPreviewFile } from "../../../../domains/build-preview/read-build-preview-file/index.ts"
import { readPreviewBuildId } from "../../../../domains/build-preview/read-preview-build-id/index.ts"
import { readPreviewSession } from "../../../../domains/build-preview/read-preview-session/index.ts"
import { readSharePreviewSession } from "../../../../domains/public-sharing/read-share-preview-session/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import type { BuildPreviewRouteDependencies } from "../../types.ts"

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
      if (!authenticated && !publicLink) {
        response.status(404).end()
        return
      }
      setSecurityHeaders(response, dependencies.applicationOrigin)

      if (request.path === "/__replica/bridge/v1.js") {
        const source = `${dependencies.bridgeSource};ReplicaHostedPreviewBridge.installHostedBridge(${JSON.stringify(dependencies.applicationOrigin)});`
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
        !authenticated &&
        shareSession &&
        (!dependencies.readAvailableShareLink ||
          !(await dependencies.readAvailableShareLink(shareSession.s, buildId)))
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
