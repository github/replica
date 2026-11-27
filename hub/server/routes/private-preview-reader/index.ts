import { randomBytes } from "node:crypto"
import express, { type Request, type Response } from "express"
import { z } from "zod"

import { hashAuthenticationValue } from "../../domains/authentication/hash-authentication-value/index.ts"
import type { ArtifactReadResult } from "../../domains/artifacts/create-artifact-storage/types.ts"
import { contentTypeForBuildPath } from "../../domains/build-artifacts/content-type-for-build-path/index.ts"
import { normalizeBuildArtifactPath } from "../../domains/build-artifacts/normalize-build-artifact-path/index.ts"
import { reserveBuildPreviewBytes } from "../../domains/build-preview/reserve-build-preview-bytes/index.ts"
import { createLaunchProof } from "../../domains/private-preview/create-launch-proof/index.ts"
import type { PrivatePreviewSettings } from "../../domains/private-preview/read-settings/index.ts"
import {
  buildMarkerLifetime,
  grantLifetime,
  maximumPrivatePreviewFileBytes,
  previewStorageKeyPattern,
  previewTokenPattern,
  sessionLifetime,
  type PrivatePreviewAuthority,
} from "../../domains/private-preview/types.ts"
import { readCookie } from "../../integrations/express/read-cookie/index.ts"
import { sendPrivatePreviewForm } from "../../integrations/express/send-private-preview-form/index.ts"
import { normalizeStartPage } from "../../utils/normalize-start-page/index.ts"
import {
  privatePreviewAddress,
  type PrivatePreviewAddress,
} from "../../utils/private-preview-address/index.ts"
import { readPrivatePreviewAddress } from "../../utils/read-private-preview-address/index.ts"

const challengeCookie = "__Host-replica-preview-challenge"
const resumeCookie = "__Host-replica-preview-resume"
const maximumPendingChallenges = 12
const maximumPendingResumes = 2
// Every retained Build sends its cookies on each request, so keep the header well within limits.
const maximumRetainedBuilds = 8
const retainedCookiePattern =
  /^__Host-replica-preview-(build-)?([1-9][0-9]{0,18})-([1-9][0-9]{0,18})$/
const cookieOptions = { httpOnly: true, secure: true, path: "/" } as const
// Hub returns each handoff with a cross-site POST, so its challenge cookie must be SameSite=None.
const handoffCookieOptions = { ...cookieOptions, sameSite: "none", maxAge: grantLifetime } as const
const playbackCookieOptions = { ...cookieOptions, sameSite: "lax" } as const
const intentForm = z.strictObject({
  intent: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+$/)
    .max(768),
})
const contentPolicy = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ")

interface ReaderOptions extends Pick<PrivatePreviewAuthority, "exchange" | "authorizeFile"> {
  settings: Pick<PrivatePreviewSettings, "hubOrigin" | "readerOrigin" | "readerSecret">
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

function buildCookie(repositoryId: string, runId: string) {
  return `__Host-replica-preview-build-${repositoryId}-${runId}`
}

function countCookies(request: Request, prefix: string) {
  return (
    request.headers.cookie?.split(";").filter((pair) => pair.trimStart().startsWith(prefix))
      .length ?? 0
  )
}

function unavailable(response: Response) {
  return response.status(503).type("text").send("Private preview is temporarily unavailable.")
}

function readCookiePairs(request: Request) {
  return (request.headers.cookie?.split(";") ?? []).flatMap((pair): [string, string][] => {
    const separator = pair.indexOf("=")
    if (separator < 0) return []
    try {
      return [
        [pair.slice(0, separator).trim(), decodeURIComponent(pair.slice(separator + 1).trim())],
      ]
    } catch {
      return []
    }
  })
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
  const proof = createLaunchProof(settings)
  // Clears the oldest other Builds so that adding this one stays within the retained limit.
  function evictRetainedBuilds(
    request: Request,
    response: Response,
    current: PrivatePreviewAddress,
  ) {
    const retained = new Map<string, { repositoryId: string; runId: string; deadline: number }>()
    for (const [name, value] of readCookiePairs(request)) {
      const [, marker, repositoryId, runId] = retainedCookiePattern.exec(name) ?? []
      const address = repositoryId && runId ? privatePreviewAddress(repositoryId, runId) : null
      if (!address || (repositoryId === current.repositoryId && runId === current.runId)) continue
      const key = `${repositoryId}/${runId}`
      const deadline = (marker && proof.readBuild(value, address)?.deadline) || 0
      retained.set(key, {
        repositoryId: address.repositoryId,
        runId: address.runId,
        deadline: Math.max(deadline, retained.get(key)?.deadline ?? 0),
      })
    }
    const oldest = [...retained.values()].sort((left, right) => left.deadline - right.deadline)
    for (const { repositoryId, runId } of oldest.slice(
      0,
      Math.max(0, oldest.length - maximumRetainedBuilds + 1),
    )) {
      response.clearCookie(accessCookie(repositoryId, runId), playbackCookieOptions)
      response.clearCookie(buildCookie(repositoryId, runId), playbackCookieOptions)
    }
  }
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
  app.post(
    "/__replica/begin/:repositoryId/:runId",
    (request, response, next) => {
      if (
        request.get("origin") !== settings.hubOrigin ||
        !request.is("application/x-www-form-urlencoded")
      )
        return response.sendStatus(404)
      next()
    },
    express.urlencoded({ extended: false, limit: "1kb", parameterLimit: 1, inflate: false }),
    (request, response) => {
      const address = privatePreviewAddress(request.params.repositoryId, request.params.runId)
      const form = intentForm.safeParse(request.body)
      if (!address || !form.success) return response.sendStatus(404)
      let atCapacity = false
      // Each launch gets its own challenge, so another tab cannot replace it.
      const continuation = proof.attest(form.data.intent, address, (id) => {
        const name = `${challengeCookie}-${id}`
        const existing = readCookie(request, name)
        if (existing && previewTokenPattern.test(existing)) return hashAuthenticationValue(existing)
        if (countCookies(request, `${challengeCookie}-`) >= maximumPendingChallenges) {
          atCapacity = true
          return null
        }
        const challenge = randomBytes(32).toString("base64url")
        response.cookie(name, challenge, handoffCookieOptions)
        return hashAuthenticationValue(challenge)
      })
      if (atCapacity) {
        return response
          .status(429)
          .type("text")
          .send("Too many pending launches. Wait a moment and reopen the Build.")
      }
      if (!continuation) return response.sendStatus(404)
      return sendPrivatePreviewForm(
        response,
        settings.hubOrigin,
        address.launchReturn,
        "continuation",
        continuation,
      )
    },
  )
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
      const body: unknown = request.body
      const ticket =
        typeof body === "object" && body !== null && "grant" in body ? body.grant : null
      if (!address || typeof ticket !== "string") return response.sendStatus(404)
      const [id, grant, extra] = ticket.split(".")
      if (
        extra !== undefined ||
        !z.uuidv4().safeParse(id).success ||
        !grant ||
        !previewTokenPattern.test(grant)
      )
        return response.sendStatus(404)
      // A renewal keeps its signed destination beside its challenge; a launch keeps only the challenge.
      const resumeName = `${resumeCookie}-${id}`
      const renewing = readCookie(request, resumeName) !== null
      const name = renewing ? resumeName : `${challengeCookie}-${id}`
      const [challenge, ...stateParts] = (readCookie(request, name) ?? "").split(".")
      const resume = renewing ? proof.readResume(stateParts.join("."), address) : null
      if (
        !challenge ||
        !previewTokenPattern.test(challenge) ||
        (!renewing && stateParts.length > 0) ||
        (renewing &&
          (!resume ||
            resume.id !== id ||
            resume.expiresAt.getTime() <= Date.now() ||
            resume.challenge !== hashAuthenticationValue(challenge)))
      ) {
        return response.sendStatus(404)
      }
      try {
        const session = await exchange(grant, address, hashAuthenticationValue(challenge))
        const page = session && (resume?.page ?? normalizeStartPage(session.startPage))
        if (
          !session ||
          !page ||
          !previewTokenPattern.test(session.access) ||
          // The signed renewal state can expire while Hub is exchanging its grant.
          (resume &&
            (resume.buildId !== session.buildId || resume.expiresAt.getTime() <= Date.now()))
        )
          return response.sendStatus(404)
        evictRetainedBuilds(request, response, address)
        response.clearCookie(name, handoffCookieOptions)
        response.cookie(accessCookie(address.repositoryId, address.runId), session.access, {
          ...playbackCookieOptions,
          maxAge: sessionLifetime,
        })
        // The marker outlives the session so a later prototype navigation can renew this Build.
        response.cookie(
          buildCookie(address.repositoryId, address.runId),
          proof.identifyBuild(address, session.buildId, Date.now() + buildMarkerLifetime),
          { ...playbackCookieOptions, maxAge: buildMarkerLifetime },
        )
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
    // Only a prototype's own navigation renews a Build this browser already opened.
    function renew() {
      if (
        !document ||
        request.method !== "GET" ||
        request.get("sec-fetch-site") !== "same-origin" ||
        request.get("sec-fetch-mode") !== "navigate" ||
        !request.originalUrl.startsWith(address.mount) ||
        countCookies(request, `${resumeCookie}-`) >= maximumPendingResumes
      )
        return null
      const marker = readCookie(request, buildCookie(address.repositoryId, address.runId))
      const buildId = marker && proof.readBuild(marker, address)?.buildId
      if (!buildId) return null
      const challenge = randomBytes(32).toString("base64url")
      const page = `/${request.originalUrl.slice(address.mount.length)}`
      const state = proof.startResume(address, buildId, hashAuthenticationValue(challenge), page)
      if (!state) return null
      response.cookie(
        `${resumeCookie}-${state.id}`,
        `${challenge}.${state.token}`,
        handoffCookieOptions,
      )
      return sendPrivatePreviewForm(
        response,
        settings.hubOrigin,
        address.launchReturn,
        "resume",
        state.token,
      )
    }
    const access = readCookie(request, accessCookie(address.repositoryId, address.runId))
    if (!access || !previewTokenPattern.test(access)) return renew() ?? response.sendStatus(404)
    let relative: string
    try {
      relative = decodeURIComponent(relativePath)
    } catch {
      return response.sendStatus(404)
    }
    const directory = !relative || relative.endsWith("/")
    const path = `dist/${relative}${directory ? "index.html" : ""}`
    const allowEntryPointFallback =
      document && !relative.replace(/\/$/, "").split("/").at(-1)?.includes(".")
    if (normalizeBuildArtifactPath(path) !== path) return response.sendStatus(404)

    try {
      const file = await authorizeFile(access, address, path, allowEntryPointFallback)
      if (response.destroyed) return
      if (file === "session-ended") return renew() ?? response.sendStatus(404)
      if (!file) return response.sendStatus(404)
      if (
        !previewStorageKeyPattern.test(file.storageKey) ||
        !Number.isSafeInteger(file.byteLength) ||
        file.byteLength < 0 ||
        file.byteLength > maximumPrivatePreviewFileBytes ||
        (file.path !== path && !(allowEntryPointFallback && file.path === "dist/index.html"))
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
        const current = await authorizeFile(access, address, path, allowEntryPointFallback)
        if (closed) return
        if (current === "session-ended") return renew() ?? response.sendStatus(404)
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
