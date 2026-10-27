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

export async function listWorkspaces(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  response.json(
    await authentication.prototypeAuthorization.listWorkspaces(
      sessionToken(authentication, request),
      request.query,
    ),
  )
}

export async function createWorkspace(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const workspace = await authentication.prototypeAuthorization.createWorkspace(
    mutationSessionToken(authentication, request),
    request.body,
  )
  response.status(201).json({ workspace })
}

export async function getWorkspace(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const workspace = await authentication.prototypeAuthorization.getWorkspace(
    sessionToken(authentication, request),
    parameter(request, "workspaceId"),
  )
  response.json({ workspace })
}

export async function setWorkspaceAccess(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const access = await authentication.prototypeAuthorization.setWorkspaceAccess(
    mutationSessionToken(authentication, request),
    parameter(request, "workspaceId"),
    parameter(request, "userId"),
    request.body,
  )
  response.json({ access })
}

export async function removeWorkspaceAccess(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  await authentication.prototypeAuthorization.removeWorkspaceAccess(
    mutationSessionToken(authentication, request),
    parameter(request, "workspaceId"),
    parameter(request, "userId"),
  )
  response.status(204).end()
}

export async function listPrototypes(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  response.json(
    await authentication.prototypeAuthorization.listPrototypes(
      sessionToken(authentication, request),
      parameter(request, "workspaceId"),
      request.query,
    ),
  )
}

export async function createPrototype(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const prototype = await authentication.prototypeAuthorization.createPrototype(
    mutationSessionToken(authentication, request),
    parameter(request, "workspaceId"),
    request.body,
  )
  response.status(201).json({ prototype })
}

export async function getPrototype(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const prototype = await authentication.prototypeAuthorization.getPrototype(
    sessionToken(authentication, request),
    parameter(request, "prototypeId"),
  )
  response.json({ prototype })
}

export async function archivePrototype(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const prototype = await authentication.prototypeAuthorization.archivePrototype(
    mutationSessionToken(authentication, request),
    parameter(request, "prototypeId"),
  )
  response.json({ prototype })
}

export async function setPrototypeAuthorization(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const prototype = await authentication.prototypeAuthorization.setPrototypeAuthorization(
    mutationSessionToken(authentication, request),
    parameter(request, "prototypeId"),
    request.body,
  )
  response.json({ prototype })
}

export async function createPublisherCredential(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const result = await authentication.prototypeAuthorization.createPublisherCredential(
    mutationSessionToken(authentication, request),
    parameter(request, "prototypeId"),
    request.body,
  )
  response.status(201).json(result)
}

export async function setPublisherActive(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const publisher = await authentication.prototypeAuthorization.setPublisherActive(
    mutationSessionToken(authentication, request),
    parameter(request, "prototypeId"),
    parameter(request, "publisherId"),
    request.body,
  )
  response.json({ publisher })
}

export async function revokePublisherCredential(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  await authentication.prototypeAuthorization.revokePublisherCredential(
    mutationSessionToken(authentication, request),
    parameter(request, "prototypeId"),
    parameter(request, "publisherId"),
    parameter(request, "credentialId"),
  )
  response.status(204).end()
}

export async function explainPrototypeAccess(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const decision = await authentication.prototypeAuthorization.explainPrototypeAccess(
    sessionToken(authentication, request),
    parameter(request, "prototypeId"),
  )
  response.json({ decision })
}

export async function setPrototypeAccess(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const access = await authentication.prototypeAuthorization.setPrototypeAccess(
    mutationSessionToken(authentication, request),
    parameter(request, "prototypeId"),
    parameter(request, "userId"),
    request.body,
  )
  response.json({ access })
}

export async function removePrototypeAccess(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  await authentication.prototypeAuthorization.removePrototypeAccess(
    mutationSessionToken(authentication, request),
    parameter(request, "prototypeId"),
    parameter(request, "userId"),
  )
  response.status(204).end()
}

export async function listVersions(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  response.json(
    await authentication.prototypeAuthorization.listVersions(
      sessionToken(authentication, request),
      parameter(request, "prototypeId"),
      request.query,
    ),
  )
}

export async function getVersion(
  authentication: AuthenticationRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const version = await authentication.prototypeAuthorization.getVersion(
    sessionToken(authentication, request),
    parameter(request, "prototypeId"),
    parameter(request, "versionId"),
  )
  response.json({ version })
}
