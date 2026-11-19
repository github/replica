import type { KeyObject } from "node:crypto"

export interface GitHubActionsClientInput {
  appId: string
  installationId: string
  privateKey: KeyObject
  githubRepositoryId: number
}

export interface GitHubActionsClientOptions {
  apiUrl?: string
  fetch?: typeof fetch
  now?: () => Date
  timeoutMs?: number
  downloadTimeoutMs?: number
}

export interface GitHubWorkflowRun {
  id: number
  runAttempt: number
  path: string
  event: string
  headBranch: string | null
  headSha: string
  status: string
  conclusion: string | null
  htmlUrl: string
  createdAt: Date
  startedAt?: Date | null
  updatedAt: Date
  repositoryId: number
  actor: { id: number; login: string; avatarUrl: string | null } | null
}

export interface GitHubWorkflowArtifact {
  id: number
  name: string
  sizeInBytes: number
  expired: boolean
  createdAt?: Date
}
