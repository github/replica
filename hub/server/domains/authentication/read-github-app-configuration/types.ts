import type { KeyObject } from "node:crypto"

export const githubSignInKeys = [
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_PROVIDER_REVISION",
] as const

export const githubAppKeys = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_WEBHOOK_SECRET",
] as const

export type GitHubSettingKey = (typeof githubSignInKeys)[number] | (typeof githubAppKeys)[number]
export type GitHubSettingState = "present" | "missing" | "invalid"
export type GitHubConfigurationStatus = "not_configured" | "incomplete" | "configured"

export interface GitHubAppCredentials {
  appId: string
  installationId: string
  privateKey: KeyObject
  webhookSecret: string
}

export interface GitHubAppConfiguration {
  status: GitHubConfigurationStatus
  signIn: GitHubConfigurationStatus
  app: GitHubConfigurationStatus
  settings: Record<GitHubSettingKey, GitHubSettingState>
  problems: { key: GitHubSettingKey; state: "missing" | "invalid" }[]
  signInCredentials?: { clientId: string; clientSecret: string; providerRevision: number }
  appCredentials?: GitHubAppCredentials
}
