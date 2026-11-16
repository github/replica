export type CopilotCredentialProviderKey =
  "ambient_cli" | "environment_token" | "github_app_installation" | "unconfigured"

export interface GitHubAppInstallationIdentity {
  appId: string
  installationId: string
  organization: string
}

export interface CopilotCredential {
  expiresAt?: Date
  githubToken?: string
}

export interface CopilotCredentialProvider {
  key: CopilotCredentialProviderKey
  configurationDigest: string | null
  githubAppInstallation: GitHubAppInstallationIdentity | null
  getCredential: () => Promise<CopilotCredential | null>
}
