import { LearningCommandError } from "../../../../integrations/learning/run-learning-command/errors.ts"
import { LearningsError } from "../errors.ts"

const rejectedDecisionCodes = new Set([
  "human_required",
  "identity_revalidation_required",
  "invalid_input",
  "invalid_record",
  "invalid_request",
  "invalid_transition",
  "not_found",
  "not_installed",
  "purpose_not_granted",
  "stale_review",
])

export function isDefinitiveDecisionRejection(error: unknown) {
  return (
    error instanceof LearningsError ||
    (error instanceof LearningCommandError && rejectedDecisionCodes.has(error.code))
  )
}
