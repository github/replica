import type { Express, NextFunction, Request, Response } from "express"
import express from "express"

import type { IdentityService, IdentitySettings } from "../utils/identity-contracts/types.ts"
import { IdentityError } from "../utils/identity-error/index.ts"

export function installIdentityRoutes(
  app: Express,
  service: IdentityService,
  settings: IdentitySettings,
) {
  const prefix = settings.secureCookies ? "__Host-" : ""
  const sessionCookie = `${prefix}replica-session`
  const oauthCookie = `${prefix}replica-oauth`
  const cookieOptions = {
    httpOnly: true,
    secure: settings.secureCookies,
    sameSite: "lax",
    path: "/",
  } as const

  function cookie(request: Request, name: string): string {
    const values = (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`))
    const value = values.length === 1 ? (values[0]?.slice(name.length + 1) ?? "") : ""
    return /^[\w-]{43}$/.test(value) ? value : ""
  }

  function csrf(request: Request): string {
    return request.get("x-csrf-token") ?? ""
  }

  function token(request: Request): string {
    return cookie(request, sessionCookie)
  }

  function confirmed(request: Request): boolean {
    const body: unknown = request.body
    return (
      typeof body === "object" && body !== null && "confirmed" in body && body.confirmed === true
    )
  }

  app.use(
    "/api",
    (request, response, next) => {
      response.set("Cache-Control", "private, no-store")
      response.set("Referrer-Policy", "no-referrer")
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.get("origin") !== settings.origin
      ) {
        next(
          new IdentityError(
            403,
            "origin_denied",
            "Submit this request from the configured Hub origin.",
          ),
        )
        return
      }
      next()
    },
    express.json({ limit: "24kb", strict: true }),
  )

  app.post("/api/setup/github", async (request, response) => {
    await service.setup(request.get("x-hub-bootstrap-secret") ?? "", request.body)
    response.status(201).json({ configured: true })
  })

  app.post("/api/auth/github", async (_request, response) => {
    const attempt = await service.start({ purpose: "sign-in" })
    response.cookie(oauthCookie, attempt.browserToken, { ...cookieOptions, maxAge: 15 * 60_000 })
    response.json({ url: attempt.url })
  })

  app.post("/api/auth/github/verify", async (request, response) => {
    const attempt = await service.start({
      purpose: "verify",
      token: token(request),
      csrfToken: csrf(request),
    })
    response.cookie(oauthCookie, attempt.browserToken, { ...cookieOptions, maxAge: 15 * 60_000 })
    response.json({ url: attempt.url })
  })

  app.post("/api/operator/enrollment", async (request, response) => {
    const attempt = await service.start({
      purpose: "enroll",
      bootstrapSecret: request.get("x-hub-bootstrap-secret"),
    })
    response.cookie(oauthCookie, attempt.browserToken, { ...cookieOptions, maxAge: 15 * 60_000 })
    response.json({ url: attempt.url })
  })

  app.get("/api/auth/github/callback", async (request, response) => {
    const { code, state } = request.query
    response.clearCookie(oauthCookie, cookieOptions)
    if (
      typeof code !== "string" ||
      typeof state !== "string" ||
      code.length > 1000 ||
      !/^[\w-]{43}$/.test(state)
    ) {
      throw new IdentityError(
        400,
        "invalid_callback",
        "GitHub sign-in was not completed. Start again.",
      )
    }
    const result = await service.complete(code, state, cookie(request, oauthCookie))
    if (result.token) response.cookie(sessionCookie, result.token, cookieOptions)
    response.redirect(303, `${settings.origin}/api/session`)
  })

  app.get("/api/session", async (request, response) => {
    const current = await service.current(token(request))
    response.json({
      user: current.user,
      session: { id: current.session.id, signedInAt: current.session.signedInAt },
      csrfToken: current.csrfToken,
    })
  })

  app.delete("/api/session", async (request, response) => {
    await service.signOut(token(request), csrf(request))
    response.clearCookie(sessionCookie, cookieOptions)
    response.status(204).end()
  })

  app.get("/api/repositories/:owner/:repository/access", async (request, response) => {
    const { owner, repository } = request.params
    if (
      typeof owner !== "string" ||
      typeof repository !== "string" ||
      !/^[\w.-]{1,100}$/.test(owner) ||
      !/^[\w.-]{1,100}$/.test(repository) ||
      [".", ".."].includes(owner) ||
      [".", ".."].includes(repository)
    ) {
      throw new IdentityError(
        400,
        "invalid_repository",
        "Supply a GitHub repository owner and name.",
      )
    }
    const permission = await service.permission(token(request), owner, repository)
    if (permission === "none") {
      throw new IdentityError(
        403,
        "repository_access_denied",
        "GitHub did not grant access to this installed repository.",
      )
    }
    response.json({ permission })
  })

  app.put("/api/administration/github-credentials", async (request, response) => {
    if (!confirmed(request)) {
      throw new IdentityError(
        400,
        "confirmation_required",
        "Confirm replacement of the GitHub App credentials.",
      )
    }
    const body: unknown = request.body
    const credentials =
      typeof body === "object" && body !== null && "credentials" in body
        ? body.credentials
        : undefined
    await service.rotate(token(request), csrf(request), credentials)
    response.status(204).end()
  })

  app.post("/api/administration/revoke-sessions", async (request, response) => {
    await service.revoke(token(request), csrf(request), confirmed(request))
    response.clearCookie(sessionCookie, cookieOptions)
    response.status(204).end()
  })

  app.get("/api/administration/security-audit", async (request, response) => {
    response.json({ records: await service.audits(token(request)) })
  })

  function identityError(error: unknown, _request: Request, response: Response) {
    if (error instanceof IdentityError) {
      response.status(error.status).json({ code: error.code, error: error.message })
      return
    }
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && "type" in error && error.type === "entity.too.large")
    ) {
      response
        .status(400)
        .json({ code: "invalid_body", error: "Supply a JSON request no larger than 24 KiB." })
      return
    }
    console.error("Hub identity request failed. Check database and provider availability.")
    response.status(503).json({
      code: "identity_unavailable",
      error: "Hub could not complete this identity request. Contact the deployment operator.",
    })
  }

  async function errorHandler(
    error: unknown,
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    if (response.headersSent) {
      next(error)
      return
    }
    try {
      await service.denied(
        token(request),
        error instanceof IdentityError ? error.code : "request_failed",
      )
    } catch {
      console.error("Hub could not record an identity denial. Check database availability.")
      response.status(503).json({
        code: "audit_unavailable",
        error: "Hub could not record this identity request. Contact the deployment operator.",
      })
      return
    }
    identityError(error, request, response)
  }
  app.use(errorHandler)
}
