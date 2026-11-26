import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../../read-learning-session/index.ts"
import { readLearningSessionDigest } from "../../read-learning-session-digest/index.ts"
import { respondLearningError } from "../../respond-learning-error/index.ts"
import type { LearningsRouteDependencies } from "../../types.ts"

const budgetSchema = z
  .object({
    monthlyBudgetCredits: z
      .string()
      .max(20)
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
      .refine((value) => Number(value) <= 1_000_000),
  })
  .strict()
const denied = {
  code: "hub_administrator_required",
  error: "Hub administrator access is required.",
}

/**
 * Sets the monthly credit budget every repository's automated evaluations share. Credits
 * are paid by the whole Hub, so only Hub administrators may change it.
 */
export function patch(dependencies: LearningsRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const budget = budgetSchema.safeParse(request.body)
      if (!budget.success) {
        response.status(422).json({
          code: "invalid_evaluation_budget",
          error: "Enter a budget from 0 to 1,000,000 credits.",
        })
        return
      }
      const session = await readLearningSession(request, dependencies)
      const sessionDigest = readLearningSessionDigest(request)
      if (!session || session.role !== "ADMINISTRATOR" || !sessionDigest) {
        response.status(403).json(denied)
        return
      }
      response.json(
        await dependencies.changeEvaluationBudget({
          actorMembershipId: session.membershipId,
          sessionDigest,
          monthlyBudgetCredits: budget.data.monthlyBudgetCredits,
        }),
      )
    } catch (error) {
      if (!respondLearningError(response, error)) next(error)
    }
  }
}
