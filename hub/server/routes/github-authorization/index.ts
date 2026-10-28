import type { Request, Response } from "express"

import type { AuthenticationRoutes } from "#server/routes/types"
import { authenticationCookies } from "#server/utils/authentication-cookies"
import { readCookie } from "#server/utils/read-cookie"
import { requireCsrfToken } from "#server/utils/require-csrf-token"

function sessionToken(authentication: AuthenticationRoutes, request: Request): string {
  const cookies = authenticationCookies(authentication.settings.secureCookies)
  return readCookie(request.headers.cookie, cookies.session)
}

function mutationSessionToken(authentication: AuthenticationRoutes, request: Request): string {
  const cookies = authenticationCookies(authentication.settings.secureCookies)
  requireCsrfToken(
    readCookie(request.headers.cookie, cookies.csrf),
    request.get("x-csrf-token") ?? "",
  )
  return readCookie(request.headers.cookie, cookies.session)
}

function parameter(request: Request, name: string): string {
  const value = request.params[name]
  return typeof value === "string" ? value : ""
}

export async function listRepositories(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
) {
  response.json({
    repositories: await authentication.githubAuthorization!.listRepositories(
      sessionToken(authentication, request),
    ),
  })
}

export async function linkRepository(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
) {
  const repository = await authentication.githubAuthorization!.linkRepository(
    mutationSessionToken(authentication, request),
    request.body,
  )
  response.status(201).json({ repository })
}

export async function updateRepository(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
) {
  const repository = await authentication.githubAuthorization!.updateRepository(
    mutationSessionToken(authentication, request),
    parameter(request, "repositorySourceId"),
    request.body,
  )
  response.json({ repository })
}

export async function unlinkRepository(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
) {
  await authentication.githubAuthorization!.unlinkRepository(
    mutationSessionToken(authentication, request),
    parameter(request, "repositorySourceId"),
  )
  response.status(204).end()
}

export async function reconcileRepository(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
) {
  const repository = await authentication.githubAuthorization!.reconcileRepository(
    mutationSessionToken(authentication, request),
    parameter(request, "repositorySourceId"),
  )
  response.json({ repository })
}

export async function processWebhook(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
) {
  response.set("Cache-Control", "private, no-store")
  response.set("Referrer-Policy", "no-referrer")
  const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0)
  const result = await authentication.githubAuthorization!.processWebhook({
    deliveryId: request.get("x-github-delivery") ?? "",
    event: request.get("x-github-event") ?? "",
    signature: request.get("x-hub-signature-256") ?? "",
    body,
  })
  response.status(result === "accepted" ? 202 : 200).json({ result })
}
