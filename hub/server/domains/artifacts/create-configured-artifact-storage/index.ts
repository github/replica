import { createArtifactStorage } from "../create-artifact-storage/index.ts"
import type { ArtifactStorage } from "../create-artifact-storage/types.ts"

export async function createConfiguredArtifactStorage(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ArtifactStorage> {
  if (environment.ARTIFACT_STORAGE_PROVIDER === "filesystem") {
    if (
      environment.AZURE_STORAGE_ACCOUNT !== undefined ||
      environment.AZURE_STORAGE_CONTAINER !== undefined ||
      environment.AZURE_CLIENT_ID !== undefined
    ) {
      throw new Error("Artifact storage configuration is invalid.")
    }
    return createArtifactStorage({
      provider: "filesystem",
      directory: environment.ARTIFACT_STORAGE_DIRECTORY ?? "",
    })
  }
  if (environment.ARTIFACT_STORAGE_PROVIDER === "azure") {
    const account = environment.AZURE_STORAGE_ACCOUNT
    if (
      environment.ARTIFACT_STORAGE_DIRECTORY !== undefined ||
      !account ||
      !/^[a-z0-9]{3,24}$/.test(account)
    ) {
      throw new Error("Artifact storage configuration is invalid.")
    }
    return createArtifactStorage({
      provider: "azure-blob",
      accountUrl: `https://${account}.blob.core.windows.net`,
      container: environment.AZURE_STORAGE_CONTAINER ?? "",
      managedIdentityClientId: environment.AZURE_CLIENT_ID,
    })
  }
  throw new Error("Artifact storage configuration is invalid.")
}
