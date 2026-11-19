import type { Request, Response } from "express"

import { readDecisionModelSession } from "../read-decision-model-session/index.ts"
import type { DecisionModelRouteDependencies } from "../types.ts"

export async function readDecisionModelMember(
  request: Request,
  response: Response,
  dependencies: DecisionModelRouteDependencies,
) {
  const session = await readDecisionModelSession(request, dependencies)
  if (!session) {
    response.status(401).json({ code: "authentication_required", error: "Sign in to continue." })
    return null
  }
  return session
}
