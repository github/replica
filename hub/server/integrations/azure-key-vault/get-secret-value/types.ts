import type { ManagedIdentityCredential } from "@azure/identity"

export interface AzureKeyVaultSecretRequest {
  url: string
  credential: Pick<ManagedIdentityCredential, "getToken">
  signal: AbortSignal
}
