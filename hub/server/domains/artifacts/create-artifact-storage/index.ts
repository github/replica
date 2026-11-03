import { createAzureBlobArtifactStorage } from "../../../integrations/azure-blob/create-azure-blob-artifact-storage/index.ts"
import { createFilesystemArtifactStorage } from "../../../integrations/filesystem/create-filesystem-artifact-storage/index.ts"
import { parseArtifactStorageSettings } from "../parse-artifact-storage-settings/index.ts"
import type { ArtifactStorage, ArtifactStorageSettings } from "./types.ts"

export const artifactMaxBytes = 32 * 1024 * 1024
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export async function createArtifactStorage(
  input: ArtifactStorageSettings,
): Promise<ArtifactStorage> {
  const settings = parseArtifactStorageSettings(input)
  const adapter =
    settings.provider === "filesystem"
      ? await createFilesystemArtifactStorage(settings.directory, artifactMaxBytes)
      : createAzureBlobArtifactStorage(settings, artifactMaxBytes)

  return {
    async read(key) {
      if (typeof key !== "string" || !keyPattern.test(key)) return { status: "invalid-key" }
      return adapter.read(key)
    },
    async write(key, bytes) {
      if (typeof key !== "string" || !keyPattern.test(key)) return { status: "invalid-key" }
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > artifactMaxBytes) {
        return { status: "too-large" }
      }
      return adapter.write(key, Uint8Array.from(bytes))
    },
    async delete(key) {
      if (typeof key !== "string" || !keyPattern.test(key)) return { status: "invalid-key" }
      return adapter.delete(key)
    },
  }
}
