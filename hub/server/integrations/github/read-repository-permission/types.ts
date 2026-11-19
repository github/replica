import type { KeyObject } from "node:crypto"

export type RepositoryPermission = "none" | "read" | "triage" | "write" | "maintain" | "admin"

export interface RepositoryPermissionInput {
  credentials: { appId: string; installationId: string; privateKey: KeyObject }
  githubRepositoryId: bigint
  login: string
  subject: string
  branchName?: string
}
