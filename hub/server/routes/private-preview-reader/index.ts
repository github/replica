import { randomBytes } from "node:crypto"
import express, { type Response } from "express"

import { hashAuthenticationValue } from "../../domains/authentication/hash-authentication-value/index.ts"
import type { ArtifactReadResult } from "../../domains/artifacts/create-artifact-storage/types.ts"
import { contentTypeForBuildPath } from "../../domains/build-artifacts/content-type-for-build-path/index.ts"
import { normalizeBuildArtifactPath } from "../../domains/build-artifacts/normalize-build-artifact-path/index.ts"
import { reserveBuildPreviewBytes } from "../../domains/build-preview/reserve-build-preview-bytes/index.ts"
import type { PrivatePreviewSettings } from "../../domains/private-preview/read-settings/index.ts"
import {
  maximumPrivatePreviewFileBytes,
  previewStorageKeyPattern,
  previewTokenPattern,
  sessionLifetime,
  type PrivatePreviewAuthority,
} from "../../domains/private-preview/types.ts"
import { readCookie } from "../../integrations/express/read-cookie/index.ts"
import { normalizeStartPage } from "../../utils/normalize-start-page/index.ts"
import {
  privatePreviewAddress,
  readPrivatePreviewAddress,
} from "../../utils/private-preview-address/index.ts"

const challengeCookie = "__Host-replica-preview-challenge"
const challengeLifetime = 5 * 60_000
const cookieOptions = { httpOnly: true, secure: true, path: "/" } as const
const contentPolicy = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ")

interface ReaderOptions extends Pick<PrivatePreviewAuthority, "exchange" | "authorizeFile"> {
  settings: Pick<PrivatePreviewSettings, "hubOrigin" | "readerOrigin">
  trustedProxyHops?: number
  readArtifact(
    this: void,
    key: string,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<ArtifactReadResult>
}

function accessCookie(repositoryId: string, runId: string) {
  return `__Host-replica-preview-${repositoryId}-${runId}`
}

function unavailable(response: Response) {
  return response.status(503).type("text").send("Private preview is temporarily unavailable.")
}

export function createPrivatePreviewReader({
  settings,
  trustedProxyHops = 0,
  exchange,
  authorizeFile,
  readArtifact,
}: ReaderOptions) {
  const app = express()
  const readerHost = new URL(settings.readerOrigin).host
  app.disable("x-powered-by")
  app.disable("etag")
  app.set("trust proxy", trustedProxyHops)
  app.use((request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store")
    response.setHeader("Referrer-Policy", "no-referrer")
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setHeader("X-Frame-Options", "DENY")
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin")
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin")
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.setHeader("Content-Security-Policy", contentPolicy)
    if (!request.secure || request.get("host") !== readerHost) return response.sendStatus(404)
    if (request.get("service-worker") || request.get("sec-fetch-dest") === "serviceworker") {
      return response.sendStatus(404)
    }
    next()
  })
  app.get("/health", (_request, response) => response.sendStatus(204))
  app.get("/__replica/begin/:repositoryId/:runId", (request, response) => {
    const address = privatePreviewAddress(request.params.repositoryId, request.params.runId)
    if (!address || request.method !== "GET") return response.sendStatus(404)
    const previous = readCookie(request, challengeCookie)
    const challenge =
      previous && previewTokenPattern.test(previous)
        ? previous
        : randomBytes(32).toString("base64url")
    response.cookie(challengeCookie, challenge, {
      ...cookieOptions,
      sameSite: "none",
      maxAge: challengeLifetime,
    })
    const destination = new URL(address.launch, settings.hubOrigin)
    destination.searchParams.set("challenge", hashAuthenticationValue(challenge))
    return response.status(302).location(destination.toString()).end()
  })
  app.post(
    "/__replica/exchange/:repositoryId/:runId",
    (request, response, next) => {
      if (
        request.get("origin") !== settings.hubOrigin ||
        !request.is("application/x-www-form-urlencoded")
      ) {
        return response.sendStatus(404)
      }
      next()
    },
    express.urlencoded({ extended: false, limit: "1kb", parameterLimit: 1, inflate: false }),
    async (request, response) => {
      const address = privatePreviewAddress(request.params.repositoryId, request.params.runId)
      const challenge = readCookie(request, challengeCookie)
      const body: unknown = request.body
      const grant = typeof body === "object" && body !== null && "grant" in body ? body.grant : null
      if (
        !address ||
        !challenge ||
        !previewTokenPattern.test(challenge) ||
        typeof grant !== "string" ||
        !previewTokenPattern.test(grant)
      ) {
        return response.sendStatus(404)
      }
      try {
        const session = await exchange(grant, address, hashAuthenticationValue(challenge))
        const page = session && normalizeStartPage(session.startPage)
        if (!session || !page || !previewTokenPattern.test(session.access))
          return response.sendStatus(404)
        response.cookie(accessCookie(address.repositoryId, address.runId), session.access, {
          ...cookieOptions,
          sameSite: "lax",
          maxAge: sessionLifetime,
        })
        return response
          .status(303)
          .location(`${address.mount}${page.slice(1)}`)
          .end()
      } catch {
        return unavailable(response)
      }
    },
  )
  app.get("/{*path}", async (request, response) => {
    const matched = readPrivatePreviewAddress(request.path)
    if (!matched) return response.sendStatus(404)
    const { address, relativePath } = matched
    const document = request.get("sec-fetch-dest") === "document"
    const access = readCookie(request, accessCookie(address.repositoryId, address.runId))
    if (!access || !previewTokenPattern.test(access)) {
      if (document && request.method === "GET" && !relativePath) {
        return response.status(401).type("html")
          .send(`<!doctype html><meta charset="utf-8"><title>Private preview</title>
<p>Open this Build in Hub to check your access.</p><a href="${settings.hubOrigin}${address.launch}">Open in Hub</a>`)
      }
      return response.sendStatus(404)
    }
    let path: string
    try {
      const relative = decodeURIComponent(relativePath)
      path = `dist/${relative}${!relative || relative.endsWith("/") ? "index.html" : ""}`
    } catch {
      return response.sendStatus(404)
    }
    if (normalizeBuildArtifactPath(path) !== path) return response.sendStatus(404)

    try {
      const file = await authorizeFile(access, address, path, document)
      if (response.destroyed) return
      if (!file) return response.sendStatus(404)
      if (
        !previewStorageKeyPattern.test(file.storageKey) ||
        !Number.isSafeInteger(file.byteLength) ||
        file.byteLength < 0 ||
        file.byteLength > maximumPrivatePreviewFileBytes ||
        (file.path !== path && !(document && file.path === "dist/index.html"))
      )
        return unavailable(response)
      const release = reserveBuildPreviewBytes(file.byteLength)
      if (!release) return unavailable(response)
      let reading = true
      let closed = false
      response.once("close", () => {
        closed = true
        if (!reading) release()
      })
      try {
        const stored = await readArtifact(
          file.storageKey,
          file.byteLength,
          AbortSignal.timeout(8_000),
        )
        if (closed) return
        if (stored.status === "not-found") return response.sendStatus(404)
        if (stored.status !== "ok" || stored.bytes.byteLength !== file.byteLength)
          return unavailable(response)
        const current = await authorizeFile(access, address, path, document)
        if (closed) return
        if (
          !current ||
          current.path !== file.path ||
          current.byteLength !== file.byteLength ||
          current.storageKey !== file.storageKey
        )
          return response.sendStatus(404)
        response.type(contentTypeForBuildPath(file.path))
        response.setHeader("Content-Length", file.byteLength)
        return response.end(request.method === "HEAD" ? undefined : stored.bytes)
      } finally {
        reading = false
        if (closed) release()
      }
    } catch {
      return unavailable(response)
    }
  })
  app.use((_request, response) => response.sendStatus(404))
  app.use(
    (error: unknown, _request: express.Request, response: Response, next: express.NextFunction) => {
      if (response.headersSent) return next(error)
      const status =
        typeof error === "object" && error !== null && "status" in error ? error.status : null
      if (status === 400 || status === 413 || status === 415) return response.sendStatus(status)
      return unavailable(response)
    },
  )
  return app
}
