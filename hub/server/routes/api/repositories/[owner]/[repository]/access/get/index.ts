import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"
import { IdentityError } from "#server/utils/identity-error"
import { readSessionToken } from "#server/utils/read-session-token"

export async function get(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service, settings } = dependencies

  const { owner, repository } = request.params
  if (
    typeof owner !== "string" ||
    typeof repository !== "string" ||
    !/^[\w.-]{1,100}$/.test(owner) ||
    !/^[\w.-]{1,100}$/.test(repository) ||
    [".", ".."].includes(owner) ||
    [".", ".."].includes(repository)
  ) {
    throw new IdentityError(400, "invalid_repository", "Supply a GitHub repository owner and name.")
  }
  const permission = await service.permission(
    readSessionToken(request, settings),
    owner,
    repository,
  )
  if (permission === "none") {
    throw new IdentityError(
      403,
      "repository_access_denied",
      "GitHub did not grant access to this installed repository.",
    )
  }
  response.json({ permission })
}
