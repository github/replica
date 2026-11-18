import type { KeyObject } from "node:crypto"

export type GitHubConnectionCheckName =
  "private_key" | "app_identity" | "installation" | "callback_url" | "repositories"
export type GitHubConnectionCheckResult = "pass" | "fail" | "unknown"

export interface GitHubConnectionCheck {
  name: GitHubConnectionCheckName
  result: GitHubConnectionCheckResult
  detail: string
  settingsUrl?: string
}

export interface GitHubConnectionTestInput {
  appId: string
  clientId?: string
  installationId: string
  privateKey: KeyObject
}

export interface GitHubConnectionTestOptions {
  apiUrl?: string
  fetch?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}
