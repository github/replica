import type { RequestHandler } from "express"

import { readBuildPreviewFile } from "../../../../domains/build-preview/read-build-preview-file/index.ts"
import { readTemplateScreenshotPath } from "../../../../domains/build-preview/template-screenshot-path/index.ts"
import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../api/auth/types.ts"
import { readProductSession } from "../../../api/product/read-product-session/index.ts"
import { canBrowseTemplates } from "../../../api/product/template-repository-access/index.ts"
import type { ProductRouteDependencies } from "../../../api/product/types.ts"
import type { BuildPreviewRouteDependencies } from "../../types.ts"
import { createPreviewResponseReservation } from "../../create-preview-response-reservation/index.ts"

export function get(
  preview: BuildPreviewRouteDependencies,
  session: CurrentSessionDependencies,
  product: ProductRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    const admission = createPreviewResponseReservation(response)
    response.setHeader("Cache-Control", "private, no-store")
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setHeader("Referrer-Policy", "no-referrer")
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.status(404).end()
        return
      }
      const rawPath = request.originalUrl.split("?")[0] ?? ""
      const match = /^\/previews\/github\/([1-9]\d{0,18})\/([1-9]\d{0,18})(\/.*)?$/.exec(rawPath)
      const path = match?.[3] ?? "/"
      let decoded: string
      try {
        decoded = decodeURIComponent(path)
      } catch {
        response.status(404).end()
        return
      }
      if (
        !match ||
        BigInt(match[1]!) > 9223372036854775807n ||
        BigInt(match[2]!) > 9223372036854775807n ||
        /%2f|%5c/i.test(path) ||
        /[\\\p{Cc}\p{Cs}]/u.test(decoded) ||
        decoded.split("/").some((part) => part === "." || part === "..") ||
        request.get("service-worker")?.toLowerCase() === "script" ||
        request.get("host") !== new URL(preview.applicationOrigin).host
      ) {
        response.status(404).end()
        return
      }
      const cookie = readCookie(request, hubSessionCookieName)
      const viewer = await readProductSession(cookie, session)
      if (!viewer) {
        response.status(401).end()
        return
      }
      const { userId, membershipId } = viewer
      const targets = await preview.findPathTargets?.(match[1]!, match[2]!)
      if (!targets || targets.length !== 1) {
        if (targets && targets.length > 1)
          request.log.warn("More than one Build owns the requested private preview path.")
        response.status(404).end()
        return
      }
      const target = targets[0]!
      async function authorized() {
        const current = await readProductSession(cookie, session)
        if (
          !current ||
          current.userId !== userId ||
          current.membershipId !== membershipId ||
          (target.template && !canBrowseTemplates(current, target.repository.local)) ||
          !(await product.isRepositoryVisible(current, target.repository.id))
        )
          return false
        const live = await preview.findPathTargets?.(match![1]!, match![2]!)
        const currentTarget = live?.length === 1 ? live[0] : undefined
        return Boolean(
          currentTarget &&
          currentTarget.buildId === target.buildId &&
          currentTarget.template === target.template &&
          currentTarget.repository.id === target.repository.id &&
          currentTarget.repository.local === target.repository.local,
        )
      }
      if (!(await authorized())) {
        response.status(404).end()
        return
      }
      const mountPath = `/previews/github/${match[1]}/${match[2]}/`
      if (!match[3]) {
        response.redirect(308, `${mountPath}${request.originalUrl.slice(rawPath.length)}`)
        return
      }
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
      )
      response.setHeader("Cross-Origin-Resource-Policy", "same-origin")
      response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
      if (decoded === "/__replica/bridge/v1.js") {
        const review = (preview.reviewBridgeSource ?? "")
          .replaceAll('"__REPLICA_HUB_ORIGIN__"', JSON.stringify(preview.applicationOrigin))
          .replaceAll('"__REPLICA_REVIEW_ENABLED__"', JSON.stringify(String(!target.template)))
        const source = `${review}\n${preview.bridgeSource};ReplicaHostedPreviewBridge.installHostedBridge(${JSON.stringify(preview.applicationOrigin)});`
        response.type("text/javascript")
        response.setHeader("Content-Length", Buffer.byteLength(source))
        response.end(source)
        return
      }
      const screenshot =
        readTemplateScreenshotPath(path) ??
        (decoded === "/__replica/screenshots/narrow.png" ? "screenshots/narrow.png" : null)
      if (
        ((decoded === "/__replica" || decoded.startsWith("/__replica/")) && !screenshot) ||
        (screenshot &&
          screenshot !== "screenshots/desktop.png" &&
          screenshot !== "screenshots/narrow.png" &&
          !target.template)
      ) {
        response.status(404).end()
        return
      }
      const file = await readBuildPreviewFile(
        {
          acceptsHtml: Boolean(
            request.accepts("html") &&
            request
              .get("accept")
              ?.split(",")
              .some((type) => type.split(";")[0]?.trim() === "text/html"),
          ),
          buildId: target.buildId,
          requestPath: path,
          mountPath,
          ifNoneMatch: screenshot ? undefined : request.get("if-none-match"),
        },
        { ...preview, reserveBytes: admission.reserveBytes },
      )
      if (response.destroyed) return
      if (!(await authorized())) {
        response.status(404).end()
        return
      }
      if (file.status === "not-modified") {
        response.setHeader("Cache-Control", "private, no-cache")
        response.setHeader("ETag", file.etag)
        response.status(304).end()
        return
      }
      if (file.status !== "ok") {
        response.status(file.status === "not-found" ? 404 : 503).end()
        return
      }
      response.setHeader("Cache-Control", screenshot ? "private, no-store" : "private, no-cache")
      response.setHeader("Content-Type", file.contentType)
      if (file.etag) response.setHeader("ETag", file.etag)
      response.setHeader("Content-Length", file.bytes.byteLength)
      response.end(file.bytes)
    } catch (error) {
      next(error)
    } finally {
      admission.completeRequest()
    }
  }
}
