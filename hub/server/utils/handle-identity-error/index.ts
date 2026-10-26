import type { NextFunction, Request, Response } from "express"

import type { IdentityService, IdentitySettings } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"
import { readSessionToken } from "#server/utils/read-session-token"
import { respondIdentityError } from "#server/utils/respond-identity-error"

export async function handleIdentityError(
  service: IdentityService,
  settings: IdentitySettings,
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  if (response.headersSent) {
    next(error)
    return
  }
  try {
    await service.denied(
      readSessionToken(request, settings),
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
  respondIdentityError(error, response)
}
