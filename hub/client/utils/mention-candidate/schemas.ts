import { z } from "zod"

export const MENTION_CANDIDATES_SCHEMA = z.object({
  candidates: z.array(
    z.object({
      githubId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      login: z.string().min(1).max(39),
      avatarUrl: z.string().nullable(),
    }),
  ),
})
