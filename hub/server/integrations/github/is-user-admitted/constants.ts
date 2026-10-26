import { z } from "zod"

export const repositoriesSchema = z.object({
  repositories: z.array(z.object({ full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/) })),
})
