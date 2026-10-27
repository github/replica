import { createHash, randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it, onTestFinished } from "vitest"

import { createLocalArtifactStorage } from "#server/integrations/artifact-storage/create-local-storage"

function storageRoot() {
  const root = path.join(process.cwd(), `.artifact-storage-test-${randomUUID()}`)
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

function digest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

describe("createLocalArtifactStorage()", () => {
  it("requires an absolute storage root", () => {
    expect(() => createLocalArtifactStorage("relative/artifacts")).toThrow(
      "HUB_ARTIFACT_STORAGE_PATH must be an absolute path.",
    )
  })

  it("stores and reads artifacts by a deterministic content-addressed key", async () => {
    const storage = createLocalArtifactStorage(storageRoot())
    const bytes = Buffer.from("content-addressed artifact")
    const contentDigest = digest(bytes)

    const stored = await storage.put(contentDigest, bytes)

    expect(stored).toEqual({
      key: `sha256/${contentDigest.slice(7, 9)}/${contentDigest.slice(7)}`,
      created: true,
    })
    expect(Buffer.from(await storage.read(stored.key))).toEqual(bytes)
  })

  it("rejects mismatched bytes without overwriting existing content", async () => {
    const storage = createLocalArtifactStorage(storageRoot())
    const original = Buffer.from("immutable artifact")
    const contentDigest = digest(original)

    const first = await storage.put(contentDigest, original)
    await expect(storage.put(contentDigest, Buffer.from("different bytes"))).rejects.toThrow(
      "Artifact bytes do not match the content digest.",
    )

    expect(Buffer.from(await storage.read(first.key))).toEqual(original)
  })

  it("converges concurrent writes for one digest on a single stored object", async () => {
    const storage = createLocalArtifactStorage(storageRoot())
    const bytes = Buffer.from("concurrent artifact")
    const contentDigest = digest(bytes)

    const results = await Promise.all([
      storage.put(contentDigest, bytes),
      storage.put(contentDigest, bytes),
    ])

    expect(new Set(results.map(({ key }) => key))).toEqual(new Set([results[0].key]))
    expect(results.filter(({ created }) => created)).toHaveLength(1)
    expect(Buffer.from(await storage.read(results[0].key))).toEqual(bytes)
  })
})
