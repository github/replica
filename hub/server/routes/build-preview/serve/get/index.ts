import type { RequestHandler } from "express"

import { injectPreviewBridge } from "../../../../domains/build-preview/inject-preview-bridge/index.ts"
import { readPreviewBuildId } from "../../../../domains/build-preview/read-preview-build-id/index.ts"
import { readPreviewSession } from "../../../../domains/build-preview/read-preview-session/index.ts"
import { readSharePreviewSession } from "../../../../domains/public-sharing/read-share-preview-session/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import { normalizeBuildArtifactPath } from "../../../../domains/build-artifacts/normalize-build-artifact-path/index.ts"
import { contentTypeForBuildPath } from "../../../../domains/build-artifacts/content-type-for-build-path/index.ts"
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

      let path =
        request.path === "/__replica/screenshots/desktop.png"
          ? "screenshots/desktop.png"
          : request.path === "/__replica/screenshots/narrow.png"
            ? "screenshots/narrow.png"
            : `dist${request.path === "/" ? "/index.html" : request.path}`
      path = normalizeBuildArtifactPath(path) ?? ""
      let artifact = path ? await dependencies.findArtifact(buildId, path) : null
      const acceptsHtml = request.accepts("html")
      if (!artifact && acceptsHtml && !request.path.split("/").at(-1)?.includes(".")) {
        path = "dist/index.html"
        artifact = await dependencies.findArtifact(buildId, path)
      }
      if (!artifact) {
        response.status(404).end()
        return
      }
      const result = await dependencies.storage.read(artifact.storageKey)
      if (result.status !== "ok") {
        response.status(result.status === "not-found" ? 404 : 503).end()
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
      const contentType = contentTypeForBuildPath(path)
      const html = contentType.startsWith("text/html")
      const bytes = html ? injectPreviewBridge(result.bytes) : result.bytes
      response.setHeader(
        "Cache-Control",
        publicLink
          ? "private, no-store"
          : html
            ? "private, no-cache"
            : "private, max-age=31536000, immutable",
      )
      response.setHeader("Content-Type", contentType)
      response.setHeader("Content-Length", bytes.byteLength)
      response.end(bytes)
    } catch (error) {
      next(error)
    }
  }
}
