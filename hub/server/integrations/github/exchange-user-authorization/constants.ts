import { z } from "zod"

export const accessTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("bearer"),
})
