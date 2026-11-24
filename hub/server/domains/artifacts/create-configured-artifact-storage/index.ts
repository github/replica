import { createArtifactStorage } from "../create-artifact-storage/index.ts"
import type { ArtifactStorage } from "../create-artifact-storage/types.ts"
import { readArtifactStorageEnvironment } from "../read-artifact-storage-environment/index.ts"

export async function createConfiguredArtifactStorage(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ArtifactStorage> {
  return createArtifactStorage(readArtifactStorageEnvironment(environment))
}
