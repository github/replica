import type { Response } from "express"

import { DecisionModelError } from "../../../../domains/decision-model/errors.ts"
import { DecisionRuntimeError } from "../../../../integrations/decision-runtime/create-decision-runtime-client/errors.ts"

export function respondDecisionModelError(response: Response, error: unknown): boolean {
  if (error instanceof DecisionModelError) {
    response.status(error.status).json({ code: error.code, error: error.message })
    return true
  }
  if (error instanceof DecisionRuntimeError) {
    const status =
      error.code === "conflict"
        ? 409
        : error.code === "not_found"
          ? 404
          : error.code === "authentication_failed"
            ? 502
            : 503
    response.status(status).json({ code: error.code, error: error.message })
    return true
  }
  return false
}
