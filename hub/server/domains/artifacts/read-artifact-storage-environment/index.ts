import { parseArtifactStorageSettings } from "../parse-artifact-storage-settings/index.ts"

export function readArtifactStorageEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (
    environment.ARTIFACT_STORAGE_PROVIDER === "filesystem" &&
    environment.AZURE_STORAGE_ACCOUNT === undefined &&
    environment.AZURE_STORAGE_CONTAINER === undefined &&
    environment.AZURE_CLIENT_ID === undefined
  ) {
    return parseArtifactStorageSettings({
      provider: "filesystem",
      directory: environment.ARTIFACT_STORAGE_DIRECTORY ?? "",
    })
  }
  const account = environment.AZURE_STORAGE_ACCOUNT
  if (
    environment.ARTIFACT_STORAGE_PROVIDER === "azure" &&
    environment.ARTIFACT_STORAGE_DIRECTORY === undefined &&
    account &&
    /^[a-z0-9]{3,24}$/.test(account)
  ) {
    return parseArtifactStorageSettings({
      provider: "azure-blob",
      accountUrl: `https://${account}.blob.core.windows.net`,
      container: environment.AZURE_STORAGE_CONTAINER ?? "",
      managedIdentityClientId: environment.AZURE_CLIENT_ID,
    })
  }
  throw new Error("Artifact storage configuration is invalid.")
}
