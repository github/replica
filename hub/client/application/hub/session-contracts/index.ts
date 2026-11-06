import { z } from "zod"

import { userSchema, workspaceCapabilitiesSchema } from "../contracts"

export const sessionResponseSchema = z.object({
  viewer: userSchema.nullable(),
  capabilities: workspaceCapabilitiesSchema,
})
