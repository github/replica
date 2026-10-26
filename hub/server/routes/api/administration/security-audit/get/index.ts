import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"
import { readSessionToken } from "#server/utils/read-session-token"

export async function handleApiAdministrationSecurityAuditGet(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service, settings } = dependencies

  response.json({ records: await service.audits(readSessionToken(request, settings)) })
}
