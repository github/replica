import type { ZodType } from "zod"

import { DecisionModelError } from "../../../../domains/decision-model/errors.ts"

export function parseDecisionModelRequest<Result>(schema: ZodType<Result>, input: unknown): Result {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new DecisionModelError(
      422,
      "invalid_request",
      "The decision-model request is not valid.",
      { cause: parsed.error },
    )
  }
  return parsed.data
}
