export type CopilotCredentialProviderKey = "environment_token"

export interface CopilotCredentialProvider {
  key: CopilotCredentialProviderKey
  configurationDigest: string | null
  getCredential: () => Promise<string | null>
}
