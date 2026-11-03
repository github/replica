import { z } from "zod"

export const mockProfiles = ["owner", "reader", "admin", "signed-out"] as const
export const mockProfileSchema = z.enum(mockProfiles)
export type MockProfile = z.infer<typeof mockProfileSchema>

export const mockScenarios = [
  "normal",
  "loading",
  "empty",
  "forbidden",
  "server-error",
  "invalid-response",
  "save-error",
] as const
export const mockScenarioSchema = z.enum(mockScenarios)
export type MockScenario = z.infer<typeof mockScenarioSchema>
