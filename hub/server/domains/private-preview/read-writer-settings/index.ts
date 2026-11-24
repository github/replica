import { privatePreviewAddress } from "../../../utils/private-preview-address/index.ts"
import { readArtifactStorageEnvironment } from "../../artifacts/read-artifact-storage-environment/index.ts"

export function readPrivatePreviewWriterSettings(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const enabled = environment.HUB_PRIVATE_PREVIEW_WRITE_ENABLED
  const repositoryId = environment.HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID
  const container = environment.HUB_PRIVATE_PREVIEW_WRITE_CONTAINER
  if (
    enabled === "false" ||
    (enabled === undefined && repositoryId === undefined && container === undefined)
  ) {
    return undefined
  }
  if (enabled !== "true") {
    throw new Error("Set HUB_PRIVATE_PREVIEW_WRITE_ENABLED to true or false.")
  }
  if (!repositoryId || !privatePreviewAddress(repositoryId, "1")) {
    throw new Error(
      "HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID must be a numeric GitHub repository ID.",
    )
  }
  const source = readArtifactStorageEnvironment(environment)
  if (source.provider !== "azure-blob" || !container || container === source.container) {
    throw new Error("Private preview publication requires a dedicated Azure Blob container.")
  }
  const storage = readArtifactStorageEnvironment({
    ...environment,
    AZURE_STORAGE_CONTAINER: container,
  })
  return { repositoryId, storage }
}
