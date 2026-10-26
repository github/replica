import { z } from "zod"

export const installationSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
