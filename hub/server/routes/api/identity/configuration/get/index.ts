import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"

export async function get(
  dependencies: IdentityRoutes,
  _request: Request,
  response: Response,
): Promise<void> {
  response.json(await dependencies.service.configuration())
}
