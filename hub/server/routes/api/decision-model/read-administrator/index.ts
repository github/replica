import type { Request, Response } from "express"

import { readDecisionModelSession } from "../read-decision-model-session/index.ts"
import type { DecisionModelRouteDependencies } from "../types.ts"

export async function readAdministrator(
  request: Request,
  response: Response,
  dependencies: DecisionModelRouteDependencies,
) {
  const session = await readDecisionModelSession(request, dependencies)
  if (!session || session.role !== "ADMINISTRATOR") {
    response.status(403).json({
      code: "repository_administrator_required",
      error: "Repository administrator access is required.",
    })
    return null
  }
  return session
}
