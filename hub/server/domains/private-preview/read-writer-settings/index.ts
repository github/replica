import { privatePreviewAddress } from "../../../utils/private-preview-address/index.ts"
import { readArtifactStorageEnvironment } from "../../artifacts/read-artifact-storage-environment/index.ts"

export class PrivatePreviewWriterConfigurationError extends Error {}

export function readPrivatePreviewWriterSettings(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const enabled = environment.HUB_PRIVATE_PREVIEW_WRITE_ENABLED
  const repositories = environment.HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID
  const container = environment.HUB_PRIVATE_PREVIEW_WRITE_CONTAINER
  if (
    enabled === "false" ||
    (enabled === undefined && repositories === undefined && container === undefined)
  ) {
    return undefined
  }
  if (enabled !== "true") {
    throw new PrivatePreviewWriterConfigurationError(
      "Set HUB_PRIVATE_PREVIEW_WRITE_ENABLED to true or false.",
    )
  }
  const repositoryIds = repositories?.split(",") ?? []
  if (
    repositoryIds.length === 0 ||
    new Set(repositoryIds).size !== repositoryIds.length ||
    repositoryIds.some((repositoryId) => !privatePreviewAddress(repositoryId, "1"))
  ) {
    throw new PrivatePreviewWriterConfigurationError(
      "HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID must list distinct numeric GitHub repository IDs, separated by commas.",
    )
  }
  try {
    const source = readArtifactStorageEnvironment(environment)
    if (source.provider === "azure-blob" && container && container !== source.container) {
      const storage = readArtifactStorageEnvironment({
        ...environment,
        AZURE_STORAGE_CONTAINER: container,
      })
      return { repositoryIds, storage }
    }
  } catch {
    throw new PrivatePreviewWriterConfigurationError(
      "Check the ordinary Azure artifact storage settings and HUB_PRIVATE_PREVIEW_WRITE_CONTAINER.",
    )
  }
  throw new PrivatePreviewWriterConfigurationError(
    "Private preview publication requires a dedicated Azure Blob container.",
  )
}
