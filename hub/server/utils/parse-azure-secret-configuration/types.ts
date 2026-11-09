export type AzureEntrypoint = "runtime" | "setup" | "provision"

export interface AzureSecretConfiguration {
  managedIdentityClientId: string
  references: Readonly<Record<string, string>>
}
