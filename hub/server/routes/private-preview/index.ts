import { timingSafeEqual } from "node:crypto"
import express, { type Express, type Request, type Response } from "express"
import { z } from "zod"

import { hashAuthenticationValue } from "../../domains/authentication/hash-authentication-value/index.ts"
import { createLaunchProof } from "../../domains/private-preview/create-launch-proof/index.ts"
import {
  maximumResumeTokenLength,
  previewDigestPattern,
  previewTokenPattern,
  resumeTokenPattern,
} from "../../domains/private-preview/types.ts"
import { authenticationSecurity } from "../../integrations/express/authentication-security/index.ts"
import { secureHubSessionCookieName } from "../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../integrations/express/read-cookie/index.ts"
import { sendPrivatePreviewForm } from "../../integrations/express/send-private-preview-form/index.ts"
import { privatePreviewAddress } from "../../utils/private-preview-address/index.ts"
import { privatePreviewSessionEndedHeader } from "../../utils/private-preview-session-ended-header/index.ts"
import type { PrivatePreviewRouteDependencies } from "./types.ts"

const addressShape = { repositoryId: z.string(), runId: z.string() }
const continuationForm = z.strictObject({
  continuation: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+$/)
    .max(768),
})
const resumeForm = z.strictObject({
  resume: z.string().max(maximumResumeTokenLength).regex(resumeTokenPattern),
})
const returnForm = z.union([continuationForm, resumeForm])
const launchForm = z.union([
  z.strictObject({ start: z.literal("one-click"), buildId: z.uuid() }),
  continuationForm,
  resumeForm,
])
const formParser = express.urlencoded({
  extended: false,
  limit: "4kb",
  parameterLimit: 2,
  inflate: false,
})
const exchangeBody = z.strictObject({
  ...addressShape,
  grant: z.string().regex(previewTokenPattern),
  challengeDigest: z.string().regex(previewDigestPattern),
})
const fileBody = z.strictObject({
  ...addressShape,
  access: z.string().regex(previewTokenPattern),
  path: z.string().max(2048),
  allowEntryPointFallback: z.boolean(),
})

export function mountPrivatePreview(
  app: Express,
  { settings, authority, hasCurrentHubSession }: PrivatePreviewRouteDependencies,
) {
  const hubHost = new URL(settings.hubOrigin).host
  const proof = createLaunchProof(settings)
  const expectedAuthorization = Buffer.from(`Bearer ${settings.readerSecret}`)
  const router = express.Router()
  router.use(authenticationSecurity(), (request, response, next) => {
    response.locals.omitLogPayload = true
    response.setHeader("Referrer-Policy", "no-referrer")
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin")
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    if (!request.secure || request.get("host") !== hubHost) {
      response.sendStatus(404)
      return
    }
    next()
  })

  function launchAddress(request: Request) {
    const { repositoryId, runId } = request.params
    return typeof repositoryId === "string" && typeof runId === "string"
      ? privatePreviewAddress(repositoryId, runId)
      : null
  }

  function requireFormFrom(origin: string) {
    return (request: Request, response: Response, next: express.NextFunction) => {
      if (request.get("origin") !== origin || !request.is("application/x-www-form-urlencoded")) {
        response.sendStatus(404)
        return
      }
      next()
    }
  }

  router.post(
    "/launch/:repositoryId/:runId",
    requireFormFrom(settings.hubOrigin),
    formParser,
    async (request, response) => {
      const address = launchAddress(request)
      const form = launchForm.safeParse(request.body)
      if (!address || !form.success) return response.sendStatus(404)
      const session = readCookie(request, secureHubSessionCookieName)
      if (!session) {
        if ("resume" in form.data) return response.redirect(303, "/")
        return response
          .status(401)
          .type("text")
          .send("Sign in to Hub, then reopen this prototype. If already signed in, sign out first.")
      }
      try {
        const sessionDigest = hashAuthenticationValue(session)
        if ("start" in form.data) {
          const { buildId } = form.data
          const status = await authority.launch(sessionDigest, address, buildId)
          if (status === "denied") return response.sendStatus(404)
          if (status === "incompatible") {
            return response
              .status(409)
              .type("text")
              .send(
                "This Build does not support private previews. Publish a Build compiled for the private preview path.",
              )
          }
          return sendPrivatePreviewForm(
            response,
            settings.readerOrigin,
            address.begin,
            "intent",
            proof.start(address, buildId, sessionDigest, await authority.launchDeadline()),
          )
        }
        const handoff =
          "continuation" in form.data
            ? proof.read(form.data.continuation, address, sessionDigest)
            : proof.readResume(form.data.resume, address)
        if (!handoff) return response.sendStatus(404)
        const { id, buildId, challenge } = handoff
        // The reader enforces its own renewal deadline at exchange, using the clock that signed it.
        const expiresAt =
          "resume" in form.data ? await authority.launchDeadline() : handoff.expiresAt
        const grant = await authority.issue(sessionDigest, address, challenge, {
          id,
          buildId,
          expiresAt,
        })
        if (!grant) {
          // Renewal falls through to normal sign-in when the Hub session itself has ended.
          if ("resume" in form.data && !(await hasCurrentHubSession(sessionDigest)))
            return response.redirect(303, "/")
          return response.sendStatus(404)
        }
        return sendPrivatePreviewForm(
          response,
          settings.readerOrigin,
          address.exchange,
          "grant",
          `${id}.${grant}`,
        )
      } catch {
        return response.sendStatus(503)
      }
    },
  )

  router.post(
    "/launch/:repositoryId/:runId/return",
    requireFormFrom(settings.readerOrigin),
    formParser,
    (request, response) => {
      const address = launchAddress(request)
      const form = returnForm.safeParse(request.body)
      if (!address || !form.success) return response.sendStatus(404)
      const valid =
        "continuation" in form.data
          ? proof.read(form.data.continuation, address)
          : proof.readResume(form.data.resume, address)
      if (!valid) return response.sendStatus(404)
      // A cross-site return cannot carry the Hub session cookie or issue access. It only relays
      // the signed state to a same-origin Hub POST, which checks the session and current access.
      const [name, value] =
        "continuation" in form.data
          ? (["continuation", form.data.continuation] as const)
          : (["resume", form.data.resume] as const)
      return sendPrivatePreviewForm(response, settings.hubOrigin, address.launch, name, value)
    },
  )

  function isReader(request: Request, response: Response) {
    const authorization = Buffer.from(request.get("authorization") ?? "")
    if (
      request.get("origin") ||
      authorization.length !== expectedAuthorization.length ||
      !timingSafeEqual(authorization, expectedAuthorization)
    ) {
      response.sendStatus(404)
      return false
    }
    if (!request.is("application/json")) {
      response.sendStatus(415)
      return false
    }
    return true
  }
  router.use(
    "/reader",
    (request, response, next) => {
      if (isReader(request, response)) next()
    },
    express.json({ limit: "4kb", inflate: false }),
  )
  router.post("/reader/exchange", async (request, response) => {
    const parsed = exchangeBody.safeParse(request.body)
    if (!parsed.success) return response.sendStatus(400)
    const { repositoryId, runId, grant, challengeDigest } = parsed.data
    const address = privatePreviewAddress(repositoryId, runId)
    if (!address) return response.sendStatus(400)
    try {
      const session = await authority.exchange(grant, address, challengeDigest)
      return session ? response.json(session) : response.sendStatus(404)
    } catch {
      return response.sendStatus(503)
    }
  })
  router.post("/reader/file", async (request, response) => {
    const parsed = fileBody.safeParse(request.body)
    if (!parsed.success) return response.sendStatus(400)
    const { repositoryId, runId, access, path, allowEntryPointFallback } = parsed.data
    const address = privatePreviewAddress(repositoryId, runId)
    if (!address) return response.sendStatus(400)
    try {
      const file = await authority.authorizeFile(access, address, path, allowEntryPointFallback)
      if (file === "session-ended")
        return response.setHeader(privatePreviewSessionEndedHeader, "1").sendStatus(404)
      return file ? response.json(file) : response.sendStatus(404)
    } catch {
      return response.sendStatus(503)
    }
  })
  router.use(
    (error: unknown, _request: Request, response: Response, next: express.NextFunction) => {
      if (response.headersSent) return next(error)
      const status =
        typeof error === "object" && error !== null && "status" in error ? error.status : null
      return response.sendStatus(status === 400 || status === 413 || status === 415 ? status : 503)
    },
  )
  app.use("/api/private-preview", router)
}
