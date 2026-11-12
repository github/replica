import type { z } from "zod"

import type { mockProfileSchema, mockScenarioSchema } from "."

export type MockProfile = z.infer<typeof mockProfileSchema>
export type MockScenario = z.infer<typeof mockScenarioSchema>
