import { randomBytes, timingSafeEqual } from "node:crypto"
import express, { type Express, type Request, type Response } from "express"
import { z } from "zod"

import { hashAuthenticationValue } from "../../domains/authentication/hash-authentication-value/index.ts"
import { previewDigestPattern, previewTokenPattern } from "../../domains/private-preview/types.ts"
import { authenticationSecurity } from "../../integrations/express/authentication-security/index.ts"
import { hubSessionCookieName } from "../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../integrations/express/read-cookie/index.ts"
import { privatePreviewAddress } from "../../utils/private-preview-address/index.ts"
import type { PrivatePreviewRouteDependencies } from "./types.ts"

const addressShape = { repositoryId: z.string(), runId: z.string() }
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
  { settings, authority }: PrivatePreviewRouteDependencies,
) {
  const hubHost = new URL(settings.hubOrigin).host
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

  router.get("/launch/:repositoryId/:runId", async (request, response) => {
    const address = privatePreviewAddress(request.params.repositoryId, request.params.runId)
    if (!address || request.method !== "GET") return response.sendStatus(404)
    const session = readCookie(request, hubSessionCookieName)
    if (!session) {
      return response
        .status(401)
        .type("text")
        .send("Sign in to Hub, then reopen this preview link.")
    }
    const challenge = request.query.challenge
    if (
      challenge !== undefined &&
      (typeof challenge !== "string" || !previewDigestPattern.test(challenge))
    ) {
      return response.sendStatus(400)
    }
    try {
      const sessionDigest = hashAuthenticationValue(session)
      const status = await authority.launch(sessionDigest, address)
      if (status === "denied") return response.sendStatus(404)
      if (status === "incompatible") {
        return response
          .status(409)
          .type("text")
          .send(
            "This Build does not support private previews. Open its Build in Hub or publish a Build compiled for the private preview path.",
          )
      }
      if (challenge === undefined) {
        return response.status(302).location(`${settings.readerOrigin}${address.begin}`).end()
      }
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      )
      // Preserve the form POST's Origin without sending the challenge in its referrer.
      response.setHeader("Referrer-Policy", "origin")
      return response.type("html")
        .send(`<!doctype html><meta charset="utf-8"><title>Confirm private preview</title>
<h1>Open private preview?</h1>
<p>Open the Build from repository ${address.repositoryId}, workflow run ${address.runId}, on the shared preview site.</p>
<form method="post" action="${address.launch}">
<input type="hidden" name="challenge" value="${challenge}">
<button type="submit">Open private preview</button></form>`)
    } catch {
      return response.sendStatus(503)
    }
  })

  router.post(
    "/launch/:repositoryId/:runId",
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
      const session = readCookie(request, hubSessionCookieName)
      const confirmation = z
        .strictObject({ challenge: z.string().regex(previewDigestPattern) })
        .safeParse(request.body)
      if (!address || !session || !confirmation.success) return response.sendStatus(404)
      try {
        const grant = await authority.issue(
          hashAuthenticationValue(session),
          address,
          confirmation.data.challenge,
        )
        if (!grant) return response.sendStatus(404)
        const nonce = randomBytes(18).toString("base64url")
        response.setHeader("Referrer-Policy", "origin")
        response.setHeader(
          "Content-Security-Policy",
          `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${settings.readerOrigin}; base-uri 'none'; frame-ancestors 'none'`,
        )
        return response.type("html")
          .send(`<!doctype html><meta charset="utf-8"><title>Open private preview</title>
<form method="post" action="${settings.readerOrigin}${address.exchange}">
<input type="hidden" name="grant" value="${grant}">
<button type="submit">Open private preview</button></form>
<script nonce="${nonce}">document.forms[0].submit()</script>`)
      } catch {
        return response.sendStatus(503)
      }
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
