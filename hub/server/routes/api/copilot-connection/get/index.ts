import type { RequestHandler } from "express"

import { copilotConnectionStatusSchema } from "../contract.ts"
import { readSessionDigest } from "../read-session-digest/index.ts"
import type { CopilotConnectionRouteDependencies } from "../types.ts"

export function get(dependencies: CopilotConnectionRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const sessionDigest = readSessionDigest(request)
      if (!sessionDigest || !(await dependencies.findSession(sessionDigest))) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const status = await dependencies.status()
      response.json(
        copilotConnectionStatusSchema.parse({
          ...status,
          refusedAt: status.refusedAt?.toISOString() ?? null,
          verifiedAt: status.verifiedAt?.toISOString() ?? null,
        }),
      )
    } catch (error) {
      next(error)
    }
  }
}
