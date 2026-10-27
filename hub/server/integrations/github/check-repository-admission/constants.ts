import { z } from "zod"

export const installedRepositoriesSchema = z.object({
  repositories: z.array(z.object({ full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/) })),
})

export const collaboratorPermissionSchema = z.object({
  user: z.object({ id: z.number().int().positive() }),
  permission: z.enum(["admin", "maintain", "write", "triage", "read", "none"]),
})
