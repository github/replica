import { z } from "zod"

export const accessTokenSchema = z.object({ access_token: z.string().min(1) })
export const profileSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  login: z.string().min(1).max(100),
  name: z.string().nullable(),
  avatar_url: z.url(),
})
