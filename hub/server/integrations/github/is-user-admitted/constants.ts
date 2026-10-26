import { z } from "zod"

export const installationsSchema = z.array(
  z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
)
export const repositoriesSchema = z.object({
  repositories: z.array(z.object({ full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/) })),
})
