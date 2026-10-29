import { z } from "zod"

export const installedRepositoriesSchema = z.object({
  repositories: z.array(
    z.object({
      id: z.number().int().positive(),
      full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      name: z.string().min(1),
      owner: z.object({ login: z.string().min(1) }),
      default_branch: z.string().min(1),
      private: z.boolean(),
    }),
  ),
})

export const collaboratorPermissionSchema = z.object({
  user: z.object({ id: z.number().int().positive() }),
  permission: z.enum(["admin", "maintain", "write", "triage", "read", "none"]),
  role_name: z.string().min(1).max(255).nullable().optional(),
})

export const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
})

export const repositoryAdmissionBatchSize = 10
export const repositoryAdmissionLimit = 100
export const repositoryAdmissionTimeoutMs = 10_000

export const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
  default_branch: z.string().min(1),
  visibility: z.enum(["internal", "private", "public"]),
})
