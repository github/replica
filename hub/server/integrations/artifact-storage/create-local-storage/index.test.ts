import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
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

function artifactPath(root: string, contentDigest: string) {
  const hash = contentDigest.slice("sha256:".length)
  return {
    algorithm: path.join(root, "sha256"),
    shard: path.join(root, "sha256", hash.slice(0, 2)),
    artifact: path.join(root, "sha256", hash.slice(0, 2), hash),
    key: `sha256/${hash.slice(0, 2)}/${hash}`,
  }
}

function bytesInShard(shard: string) {
  for (let index = 0; ; index += 1) {
    const bytes = Buffer.from(`outside write probe ${index}`)
    if (digest(bytes).slice("sha256:".length, "sha256:".length + 2) === shard) return bytes
  }
}

async function expectSymlinkRejected({
  root,
  key,
  contentDigest,
  bytes,
  sentinel,
  writeProbe,
}: {
  root: string
  key: string
  contentDigest: string
  bytes: Uint8Array
  sentinel: string
  writeProbe?: { bytes: Uint8Array; outsidePath: string }
}) {
  const storage = createLocalArtifactStorage(root)

  await expect(storage.read(key)).rejects.toThrow(
    "Artifact storage paths cannot contain symbolic links.",
  )
  await expect(storage.put(contentDigest, bytes)).rejects.toThrow(
    "Artifact storage paths cannot contain symbolic links.",
  )
  if (writeProbe) {
    await expect(storage.put(digest(writeProbe.bytes), writeProbe.bytes)).rejects.toThrow(
      "Artifact storage paths cannot contain symbolic links.",
    )
    await expect(readFile(writeProbe.outsidePath)).rejects.toMatchObject({ code: "ENOENT" })
  }
  await expect(storage.remove(key)).rejects.toThrow(
    "Artifact storage paths cannot contain symbolic links.",
  )
  expect(await readFile(sentinel)).toEqual(bytes)
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

  it("rejects a symbolic-link storage root without reading, replaying, or removing outside content", async () => {
    const root = storageRoot()
    const outside = storageRoot()
    const bytes = Buffer.from("outside root sentinel")
    const contentDigest = digest(bytes)
    const location = artifactPath(outside, contentDigest)
    await mkdir(location.shard, { recursive: true })
    await writeFile(location.artifact, bytes)
    await symlink(outside, root, "dir")
    const writeBytes = Buffer.from("outside write probe")

    await expectSymlinkRejected({
      root,
      key: location.key,
      contentDigest,
      bytes,
      sentinel: location.artifact,
      writeProbe: {
        bytes: writeBytes,
        outsidePath: artifactPath(outside, digest(writeBytes)).artifact,
      },
    })
  })

  it.each(["sha256", "shard"] as const)(
    "rejects a symbolic-link %s directory without reading, replaying, or removing outside content",
    async (level) => {
      const root = storageRoot()
      const outside = storageRoot()
      const bytes = Buffer.from(`outside ${level} sentinel`)
      const contentDigest = digest(bytes)
      const inside = artifactPath(root, contentDigest)
      const outsideLocation = artifactPath(outside, contentDigest)
      const writeBytes =
        level === "shard"
          ? bytesInShard(contentDigest.slice("sha256:".length, "sha256:".length + 2))
          : Buffer.from("outside write probe")

      if (level === "sha256") {
        await mkdir(outsideLocation.shard, { recursive: true })
        await writeFile(outsideLocation.artifact, bytes)
        await mkdir(root, { recursive: true })
        await symlink(outsideLocation.algorithm, inside.algorithm, "dir")
      } else {
        await mkdir(inside.algorithm, { recursive: true })
        await mkdir(outsideLocation.shard, { recursive: true })
        await writeFile(outsideLocation.artifact, bytes)
        await symlink(outsideLocation.shard, inside.shard, "dir")
      }

      await expectSymlinkRejected({
        root,
        key: inside.key,
        contentDigest,
        bytes,
        sentinel: outsideLocation.artifact,
        writeProbe: {
          bytes: writeBytes,
          outsidePath: artifactPath(outside, digest(writeBytes)).artifact,
        },
      })
    },
  )

  it("rejects a symbolic-link artifact without reading, replaying, or removing its outside target", async () => {
    const root = storageRoot()
    const outside = storageRoot()
    const bytes = Buffer.from("outside artifact sentinel")
    const contentDigest = digest(bytes)
    const location = artifactPath(root, contentDigest)
    const sentinel = path.join(outside, "sentinel")
    await mkdir(location.shard, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(sentinel, bytes)
    await symlink(sentinel, location.artifact)

    await expectSymlinkRejected({
      root,
      key: location.key,
      contentDigest,
      bytes,
      sentinel,
    })
  })
})
