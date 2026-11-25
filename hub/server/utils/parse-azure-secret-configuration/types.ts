export type AzureEntrypoint = "runtime" | "setup" | "provision" | "provision-learning"

export interface AzureSecretConfiguration {
  managedIdentityClientId: string
  references: Readonly<Record<string, string>>
}
