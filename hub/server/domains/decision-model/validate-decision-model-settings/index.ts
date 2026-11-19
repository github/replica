import { z } from "zod"

import type { DecisionModelSettings } from "../types.ts"

const settings = z
  .object({
    enabled: z.boolean(),
    backend: z.string().regex(/^[a-z][a-z0-9-]{0,99}$/),
    maxUpdates: z.number().int().min(1).max(100_000),
    maxSeconds: z.number().int().min(1).max(86_400),
    monthlyBudgetCredits: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (Number(value.monthlyBudgetCredits) > 1_000_000) {
      context.addIssue({
        code: "custom",
        message: "monthlyBudgetCredits must not exceed 1000000.",
        path: ["monthlyBudgetCredits"],
      })
    }
  })

export function validateDecisionModelSettings(input: unknown): DecisionModelSettings {
  return settings.parse(input)
}
