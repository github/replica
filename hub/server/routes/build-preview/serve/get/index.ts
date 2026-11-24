import type { RequestHandler } from "express"

import {
  LEGACY_PREVIEW_BRIDGE_PATHS,
  PREVIEW_BRIDGE_PATH,
} from "../../../../domains/build-preview/inject-preview-bridge/constants.ts"
import { readBuildPreviewFile } from "../../../../domains/build-preview/read-build-preview-file/index.ts"
import { readPreviewBuildId } from "../../../../domains/build-preview/read-preview-build-id/index.ts"
import { readPreviewSession } from "../../../../domains/build-preview/read-preview-session/index.ts"
import { readTemplateScreenshotPath } from "../../../../domains/build-preview/template-screenshot-path/index.ts"
import { reserveBuildPreviewBytes } from "../../../../domains/build-preview/reserve-build-preview-bytes/index.ts"
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

export function get(
  dependencies: BuildPreviewRouteDependencies,
  canReadTemplate?: (
    sessionDigest: string,
    repository: { id: string; local: boolean },
  ) => Promise<boolean>,
): RequestHandler {
  async function authorizePrivate(
    session: NonNullable<ReturnType<typeof readPreviewSession>>,
    buildId: string,
  ) {
    if (!session.t && !(await dependencies.restoreSession?.(session.s))) return false
    const target = await dependencies.findTargetById(buildId, session.t ? "template" : "preview")
    return session.t
      ? Boolean(
          target?.templateRepository &&
          (await canReadTemplate?.(session.s, target.templateRepository)),
        )
      : Boolean(target)
  }

  return async (request, response, next) => {
    const reservations = new Set<() => void>()
    let handlingRequest = true
    let responseEnded = response.destroyed || response.writableFinished
    function releaseReservations() {
      if (handlingRequest || !responseEnded) return
      response.off("finish", onResponseEnd)
      response.off("close", onResponseEnd)
      for (const release of reservations) release()
    }
    function onResponseEnd() {
      responseEnded = true
      releaseReservations()
    }
    response.once("finish", onResponseEnd)
    response.once("close", onResponseEnd)
    try {
      const buildId = readPreviewBuildId(request.get("host"), dependencies.previewBaseOrigin)
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
      const privateAuthorized = authenticated && (await authorizePrivate(authenticated, buildId))
      const publicLink =
        !privateAuthorized && shareSession && dependencies.readAvailableShareLink
          ? await dependencies.readAvailableShareLink(shareSession.s, buildId)
          : null
      if (!privateAuthorized && !publicLink) {
        response.status(404).end()
        return
      }
      const templateScreenshot = readTemplateScreenshotPath(request.path)
      if (
        templateScreenshot &&
        templateScreenshot !== "screenshots/desktop.png" &&
        !(privateAuthorized && authenticated && authenticated.t)
      ) {
        response.status(404).end()
        return
      }
      const screenshot =
        templateScreenshot ||
        request.path === "/__replica/screenshots/desktop.png" ||
        request.path === "/__replica/screenshots/narrow.png"
      setSecurityHeaders(
        response,
        dependencies.applicationOrigin,
        Boolean(privateAuthorized && screenshot),
      )

      if (
        request.path === PREVIEW_BRIDGE_PATH ||
        LEGACY_PREVIEW_BRIDGE_PATHS.includes(request.path)
      ) {
        const reviewSource = (dependencies.reviewBridgeSource ?? "")
          .replace('"__REPLICA_HUB_ORIGIN__"', JSON.stringify(dependencies.applicationOrigin))
          .replace(
            '"__REPLICA_REVIEW_ENABLED__"',
            JSON.stringify(String(Boolean(privateAuthorized && authenticated && !authenticated.t))),
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
          distOnly: publicLink?.hosted,
          reportMount: Boolean(privateAuthorized),
          requestPath: request.path,
        },
        {
          ...dependencies,
          reserveBytes(byteLength) {
            if (responseEnded) return null
            const reservation = reserveBuildPreviewBytes(byteLength)
            if (!reservation) return null
            const release = reservation
            function trackedRelease() {
              reservations.delete(trackedRelease)
              release()
            }
            reservations.add(trackedRelease)
            return trackedRelease
          },
        },
      )
      if (response.destroyed) return
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
        (!authenticated || !(await authorizePrivate(authenticated, buildId)))
      ) {
        response.status(404).end()
        return
      }
      response.setHeader(
        "Cache-Control",
        publicLink || (templateScreenshot && authenticated && authenticated.t)
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
    } finally {
      handlingRequest = false
      releaseReservations()
    }
  }
}
