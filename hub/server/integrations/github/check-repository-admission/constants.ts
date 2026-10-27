import { z } from "zod"

export const installedRepositoriesSchema = z.object({
  repositories: z.array(
    z.object({
      id: z.number().int().positive(),
      full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      name: z.string().min(1),
      owner: z.object({ login: z.string().min(1) }),
      default_branch: z.string().min(1),
    }),
  ),
})

export const collaboratorPermissionSchema = z.object({
  user: z.object({ id: z.number().int().positive() }),
  permission: z.enum(["admin", "maintain", "write", "triage", "read", "none"]),
})

export const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
  default_branch: z.string().min(1),
})
