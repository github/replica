import type { Request, Response } from "express"

import type { IdentityRoutes } from "#server/routes/types"

export async function handleApiSetupGithubPost(
  dependencies: IdentityRoutes,
  request: Request,
  response: Response,
): Promise<void> {
  const { service } = dependencies

  await service.setup(request.get("x-hub-bootstrap-secret") ?? "", request.body)
  response.status(201).json({ configured: true })
}
