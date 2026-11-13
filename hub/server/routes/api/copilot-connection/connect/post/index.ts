import type { RequestHandler } from "express"
import { z } from "zod"

import { CopilotConnectionError } from "../../../../../domains/copilot-connection/errors.ts"
import { LearningCommandError } from "../../../../../integrations/learning/run-learning-command/errors.ts"
import { readSessionDigest } from "../../read-session-digest/index.ts"
import type { CopilotConnectionRouteDependencies } from "../../types.ts"

const bodySchema = z.object({ confirmed: z.literal(true) }).strict()
const reportedFailureCodes = new Set([
  "cancelled",
  "invalid_request",
  "learning_failed",
  "not_installed",
  "output_too_large",
  "timeout",
  "unreadable_output",
])

export function post(dependencies: CopilotConnectionRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      if (!bodySchema.safeParse(request.body).success) {
        response.status(400).json({ error: "Confirm the Copilot connection change." })
        return
      }
      const sessionDigest = readSessionDigest(request)
      if (!sessionDigest || !(await dependencies.findSession(sessionDigest))) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      await dependencies.connect({ sessionDigest })
      response.status(204).end()
    } catch (error) {
      if (error instanceof CopilotConnectionError) {
        const status =
          error.code === "not_authorized"
            ? 403
            : error.code === "busy"
              ? 409
              : error.code === "credential_missing"
                ? 409
                : error.code === "connection_changed"
                  ? 409
                  : error.code === "credential_refused"
                    ? 422
                    : 503
        if (status === 503) {
          const failureCode =
            error.cause instanceof LearningCommandError &&
            reportedFailureCodes.has(error.cause.code)
              ? error.cause.code
              : "unknown"
          dependencies.reportFailure(failureCode)
        }
        response.status(status).json({ error: error.message })
        return
      }
      next(error)
    }
  }
}
