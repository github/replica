export type CopilotCredentialProviderKey = "ambient_cli" | "environment_token" | "unconfigured"

export interface CopilotCredential {
  githubToken?: string
}

export interface CopilotCredentialProvider {
  key: CopilotCredentialProviderKey
  configurationDigest: string | null
  getCredential: () => Promise<CopilotCredential | null>
}
