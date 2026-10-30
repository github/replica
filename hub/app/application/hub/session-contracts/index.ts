import { z } from "zod"

import { userSchema, workspaceCapabilitiesSchema } from "../contracts"

export const mockProfiles = ["owner", "reader", "admin", "signed-out"] as const
export const mockProfileSchema = z.enum(mockProfiles)
export const sessionResponseSchema = z.object({
  viewer: userSchema.nullable(),
  profile: mockProfileSchema,
  revision: z.number().int().nonnegative(),
  capabilities: workspaceCapabilitiesSchema,
})

export type MockProfile = z.infer<typeof mockProfileSchema>
export type SessionResponse = z.infer<typeof sessionResponseSchema>
export type MockCapability = keyof SessionResponse["capabilities"]
