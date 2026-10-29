import { z } from "zod"

export const installedRepositoriesSchema = z.object({
  repositories: z.array(
    z.object({
      full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      private: z.boolean(),
    }),
  ),
})

export const collaboratorPermissionSchema = z.object({
  user: z.object({ id: z.number().int().positive() }),
  permission: z.enum(["admin", "maintain", "write", "triage", "read", "none"]),
})

export const repositoryAdmissionBatchSize = 10
export const repositoryAdmissionLimit = 100
export const repositoryAdmissionTimeoutMs = 10_000
