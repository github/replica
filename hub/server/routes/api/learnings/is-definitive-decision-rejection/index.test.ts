import { describe, expect, it } from "vitest"

import { LearningCommandError } from "../../../../integrations/learning/run-learning-command/errors"
import { isDefinitiveDecisionRejection } from "."

describe("isDefinitiveDecisionRejection()", () => {
  it.each(["not_found", "stale_review", "invalid_transition"])(
    "finalizes the durable operation after %s",
    (code) => {
      expect(isDefinitiveDecisionRejection(new LearningCommandError(code, "rejected"))).toBe(true)
    },
  )

  it.each(["timeout", "unreadable_output", "output_too_large", "learning_failed"])(
    "preserves the durable operation after ambiguous %s",
    (code) => {
      expect(isDefinitiveDecisionRejection(new LearningCommandError(code, "unknown"))).toBe(false)
    },
  )
})
