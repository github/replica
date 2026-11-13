import type { RequestHandler } from "express"
import { z } from "zod"

import type { CopilotConnectionRouteDependencies } from "../../types.ts"
import { readSessionDigest } from "../../read-session-digest/index.ts"

const idSchema = z.uuid()

export function get(dependencies: CopilotConnectionRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const id = idSchema.safeParse(request.params.id)
      if (!id.success) {
        response.status(400).json({ error: "The authorization identifier is invalid." })
        return
      }
      const sessionDigest = readSessionDigest(request)
      const session =
        sessionDigest && dependencies.authorization
          ? await dependencies.authorization.findSession(sessionDigest)
          : null
      if (!session) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      if (!dependencies.authorization) {
        response.status(404).json({ error: "Copilot authorization is unavailable." })
        return
      }
      const authorization = (await dependencies.authorization.getAuthorization({
        authorizationId: id.data,
        hubSessionId: session.id,
      })) as {
        expiresAt: Date
        operation: string
        verifiedAt: Date
      } | null
      if (
        !authorization ||
        !["CONNECT_COPILOT", "DISCONNECT_COPILOT"].includes(authorization.operation)
      ) {
        response.status(410).json({ error: "This Copilot authorization is unavailable." })
        return
      }
      response.json({
        authorization: {
          expiresAt: authorization.expiresAt.toISOString(),
          operation: authorization.operation,
          verifiedAt: authorization.verifiedAt.toISOString(),
        },
      })
    } catch (error) {
      next(error)
    }
  }
}
