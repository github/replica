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
import { sendPrivatePreviewMessage } from "../../integrations/express/send-private-preview-message/index.ts"
import { normalizeStartPage } from "../../utils/normalize-start-page/index.ts"
import {
  privatePreviewAddress,
  type PrivatePreviewAddress,
} from "../../utils/private-preview-address/index.ts"
import { readPrivatePreviewAddress } from "../../utils/read-private-preview-address/index.ts"

const challengeCookie = "__Host-replica-preview-challenge"
const resumeCookie = "__Host-replica-preview-resume"
// Only this host can set a __Host- cookie, so playback cookies are bound to it.
const browserCookie = "__Host-replica-preview-browser"
const maximumPendingChallenges = 12
const maximumPendingResumes = 2
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" } as const
// Hub and the reader share a site, so each same-site handoff POST carries a Lax challenge.
const handoffCookieOptions = { ...cookieOptions, path: "/", maxAge: grantLifetime } as const
const intentForm = z.strictObject({
  intent: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+$/)
    .max(768),
})
const exchangeForm = z.strictObject({
  grant: z.string().max(256),
  page: z.string().max(2048).optional(),
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
  settings: Pick<PrivatePreviewSettings, "hubOrigin" | "readerOrigin" | "readerSecret" | "inline">
  trustedProxyHops?: number
  readArtifact(
    this: void,
    key: string,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<ArtifactReadResult>
}

// Playback cookies stay host-only but use the Build's mount path, so a browser sends only the
// opened Build's cookies instead of every Build's cookies on each request.
function accessCookie({ repositoryId, runId }: PrivatePreviewAddress) {
  return `__Secure-replica-preview-${repositoryId}-${runId}`
}

function buildCookie({ repositoryId, runId }: PrivatePreviewAddress) {
  return `__Secure-replica-preview-build-${repositoryId}-${runId}`
}

// Another host on the site can add a same-named cookie, so use the first value that verifies.
function readSignedCookie(
  request: Request,
  name: string,
  open: (value: string) => string | null,
): string | null {
  for (const pair of request.headers.cookie?.split(";") ?? []) {
    const separator = pair.indexOf("=")
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue
    const value = pair.slice(separator + 1).trim()
    const opened = value.length <= 512 ? open(value) : null
    if (opened) return opened
  }
  return null
}

function readBrowser(request: Request) {
  const browser = readCookie(request, browserCookie)
  return browser && previewTokenPattern.test(browser) ? browser : null
}

// Keeps one browser binding for every Build so parallel launches do not replace each other's.
function ensureBrowser(request: Request, response: Response) {
  const browser = readBrowser(request) ?? randomBytes(32).toString("base64url")
  response.cookie(browserCookie, browser, {
    ...cookieOptions,
    path: "/",
    maxAge: buildMarkerLifetime,
  })
  return browser
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
  // Only the opted-in Hub launch shell may frame reader documents.
  function framed(request: Request) {
    return settings.inline && request.get("sec-fetch-dest") === "iframe"
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
      if (
        !address ||
        !form.success ||
        (request.get("sec-fetch-dest") === "iframe" && !framed(request))
      )
        return response.sendStatus(404)
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
      ensureBrowser(request, response)
      if (framed(request))
        return sendPrivatePreviewMessage(response, settings.hubOrigin, "continuation", continuation)
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
    express.urlencoded({ extended: false, limit: "4kb", parameterLimit: 2, inflate: false }),
    async (request, response) => {
      const address = privatePreviewAddress(request.params.repositoryId, request.params.runId)
      const form = exchangeForm.safeParse(request.body)
      if (!address || !form.success) return response.sendStatus(404)
      // Hub's inline shell can open a launch at a deep-linked route inside this Build's mount.
      const launchPage = form.data.page
      if (launchPage !== undefined && normalizeStartPage(launchPage) !== launchPage)
        return response.sendStatus(404)
      const [id, grant, extra] = form.data.grant.split(".")
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
        (renewing && launchPage !== undefined) ||
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
        const page =
          session && (resume?.page ?? launchPage ?? normalizeStartPage(session.startPage))
        if (
          !session ||
          !page ||
          !previewTokenPattern.test(session.access) ||
          // The signed renewal state can expire while Hub is exchanging its grant.
          (resume &&
            (resume.buildId !== session.buildId || resume.expiresAt.getTime() <= Date.now()))
        )
          return response.sendStatus(404)
        response.clearCookie(name, handoffCookieOptions)
        const browser = ensureBrowser(request, response)
        const playbackCookieOptions = { ...cookieOptions, path: address.mount }
        response.cookie(accessCookie(address), proof.sealAccess(address, browser, session.access), {
          ...playbackCookieOptions,
          maxAge: sessionLifetime,
        })
        // The marker outlives the session so a later prototype navigation can renew this Build.
        response.cookie(
          buildCookie(address),
          proof.identifyBuild(address, session.buildId, Date.now() + buildMarkerLifetime, browser),
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
    const inFrame = framed(request)
    const document = request.get("sec-fetch-dest") === "document" || inFrame
    const browser = readBrowser(request)
    // Only a prototype's own navigation renews a Build this browser already opened.
    function renew() {
      if (
        !document ||
        request.method !== "GET" ||
        request.get("sec-fetch-site") !== "same-origin" ||
        request.get("sec-fetch-mode") !== "navigate" ||
        !request.originalUrl.startsWith(address.mount) ||
        countCookies(request, `${resumeCookie}-`) >= maximumPendingResumes ||
        !browser
      )
        return null
      const buildId = readSignedCookie(
        request,
        buildCookie(address),
        (marker) => proof.readBuild(marker, address, browser)?.buildId ?? null,
      )
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
      if (inFrame)
        return sendPrivatePreviewMessage(response, settings.hubOrigin, "resume", state.token)
      return sendPrivatePreviewForm(
        response,
        settings.hubOrigin,
        address.launchReturn,
        "resume",
        state.token,
      )
    }
    const access =
      browser &&
      readSignedCookie(request, accessCookie(address), (value) =>
        proof.openAccess(value, address, browser),
      )
    if (!access) return renew() ?? response.sendStatus(404)
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
        if (inFrame) {
          response.removeHeader("X-Frame-Options")
          response.setHeader(
            "Content-Security-Policy",
            contentPolicy.replace(
              "frame-ancestors 'none'",
              `frame-ancestors ${settings.hubOrigin}`,
            ),
          )
        }
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
