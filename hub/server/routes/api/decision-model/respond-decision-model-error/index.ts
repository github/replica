import type { Response } from "express"
import { ZodError } from "zod"

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
  if (error instanceof ZodError) {
    response.status(422).json({
      code: "invalid_decision_model_request",
      error: "The decision-model request is not valid.",
    })
    return true
  }
  return false
}
