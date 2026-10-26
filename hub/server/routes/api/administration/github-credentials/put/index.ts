import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"
import { IdentityError } from "#server/utils/identity-error"
import { readConfirmation } from "#server/utils/read-confirmation"
import { readSessionToken } from "#server/utils/read-session-token"

export async function handleApiAdministrationGithubCredentialsPut(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service, settings } = dependencies

  if (!readConfirmation(request.body)) {
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
  await service.rotate(
    readSessionToken(request, settings),
    request.get("x-csrf-token") ?? "",
    credentials,
  )
  response.status(204).end()
}
