import type { Response } from "express"

import { LearningCommandError } from "../../../../integrations/learning/run-learning-command/errors.ts"
import { LearningsError } from "../errors.ts"

const staleCodes = new Set(["digest_mismatch", "stale_digest", "stale_review"])
const notFoundCodes = new Set(["not_found", "memory_not_found"])

export function respondLearningError(response: Response, error: unknown): boolean {
  if (error instanceof LearningsError) {
    response.status(error.status).json({ code: error.code, error: error.message })
    return true
  }
  if (error instanceof LearningCommandError) {
    const status =
      staleCodes.has(error.code) || error.code === "repository_scope_unavailable"
        ? 409
        : notFoundCodes.has(error.code)
          ? 404
          : 422
    response.status(status).json({ code: error.code, error: error.message })
    return true
  }
  return false
}
