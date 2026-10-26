import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"
import { readSessionToken } from "#server/utils/read-session-token"

export async function get(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service, settings } = dependencies

  const current = await service.current(readSessionToken(request, settings))
  response.json({
    user: current.user,
    session: { id: current.session.id, signedInAt: current.session.signedInAt },
    csrfToken: current.csrfToken,
  })
}
