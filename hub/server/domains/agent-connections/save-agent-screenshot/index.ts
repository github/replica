import { createHash, randomUUID } from "node:crypto"

import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"

/**
 * Keeps one agent screenshot in Hub's artifact storage. The record is written before the
 * bytes, so withdrawing consent always finds every image it has to delete.
 */
export async function saveAgentScreenshot(
  dependencies: {
    create(input: {
      repositoryId: string
      grantId: string
      sha256: string
      storageKey: string
    }): Promise<{ storageKey: string }>
    storage: Pick<ArtifactStorage, "write">
  },
  input: { repositoryId: string; grantId: string; bytes: Uint8Array },
) {
  const record = await dependencies.create({
    repositoryId: input.repositoryId,
    grantId: input.grantId,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    storageKey: randomUUID(),
  })
  const { status } = await dependencies.storage.write(record.storageKey, input.bytes)
  if (status !== "ok" && status !== "already-exists") {
    throw new Error(`Hub could not store an agent screenshot (${status}).`)
  }
}
