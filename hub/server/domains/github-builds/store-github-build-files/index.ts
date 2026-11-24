import { createHash } from "node:crypto"

import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"
import type { BuildPackageFile } from "../../build-artifacts/types.ts"
import type { StoredGitHubBuildArtifact } from "../../../repositories/github-builds/types.ts"

function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32)
}

/**
 * Writes files under keys derived from the Build, path, and content, so retries
 * reuse identical objects and never replace different bytes. Keys are never
 * deleted; an unreferenced key after a failed import is harmless.
 */
export async function storeGitHubBuildFiles(
  storage: ArtifactStorage,
  buildId: string,
  files: BuildPackageFile[],
): Promise<StoredGitHubBuildArtifact[]> {
  const artifacts: StoredGitHubBuildArtifact[] = []
  for (const file of files) {
    const storageKey = `gha-${buildId.replaceAll("-", "")}-${digest(file.path)}-${digest(file.bytes)}`
    const write = await storage.write(storageKey, file.bytes)
    if (write.status === "already-exists") {
      const existing = await storage.read(storageKey)
      if (existing.status !== "ok" || !file.bytes.equals(existing.bytes)) {
        throw new Error(`Artifact storage contains different bytes for ${file.path}.`)
      }
    } else if (write.status !== "ok") {
      throw new Error(`Artifact storage rejected ${file.path} with ${write.status}.`)
    }
    artifacts.push({
      path: file.path,
      kind: file.kind,
      storageKey,
      byteLength: file.bytes.byteLength,
    })
  }
  return artifacts
}
