import { z } from "zod"

export const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(255),
  name: z.string().max(255).nullable(),
  avatar_url: z.url().nullable(),
})
