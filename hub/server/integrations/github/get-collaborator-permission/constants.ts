import { z } from "zod"

export const collaboratorPermissionSchema = z.object({
  permission: z.enum(["admin", "write", "read", "maintain", "triage", "none"]),
  user: z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
})
