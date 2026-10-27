import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { constants } from "node:fs"
import { access, link, mkdir, open, readFile, rm } from "node:fs/promises"
import path from "node:path"

import type { ArtifactStorage, StoredArtifact } from "#server/integrations/artifact-storage/types"

function artifactKey(contentDigest: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(contentDigest)) {
    throw new Error("Artifact content digest is invalid.")
  }
  const digest = contentDigest.replace(/^sha256:/, "")
  return path.posix.join("sha256", digest.slice(0, 2), digest)
}

function storagePath(root: string, key: string): string {
  const candidate = path.resolve(root, key)
  const resolvedRoot = path.resolve(root)
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Artifact storage key is invalid.")
  }
  return candidate
}

function calculateContentDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

async function verifyExisting(destination: string, contentDigest: string): Promise<void> {
  const expected = Buffer.from(contentDigest.replace(/^sha256:/, ""), "hex")
  const actual = createHash("sha256")
    .update(await readFile(destination))
    .digest()
  if (!timingSafeEqual(expected, actual)) {
    throw new Error("Stored artifact content does not match its key.")
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === code
  )
}

export function createLocalArtifactStorage(root: string): ArtifactStorage {
  if (!path.isAbsolute(root)) {
    throw new Error("HUB_ARTIFACT_STORAGE_PATH must be an absolute path.")
  }
  return {
    async put(contentDigest: string, bytes: Uint8Array): Promise<StoredArtifact> {
      const key = artifactKey(contentDigest)
      if (calculateContentDigest(bytes) !== contentDigest) {
        throw new Error("Artifact bytes do not match the content digest.")
      }
      const destination = storagePath(root, key)
      await mkdir(path.dirname(destination), { recursive: true })
      try {
        await access(destination, constants.F_OK)
        await verifyExisting(destination, contentDigest)
        return { key, created: false }
      } catch (error) {
        if (!isFileSystemError(error, "ENOENT")) throw error
      }

      const temporary = `${destination}.${randomUUID()}.tmp`
      const file = await open(temporary, "wx", 0o600)
      try {
        await file.writeFile(bytes)
        await file.sync()
      } finally {
        await file.close()
      }
      try {
        await link(temporary, destination)
        return { key, created: true }
      } catch (error) {
        if (!isFileSystemError(error, "EEXIST")) throw error
        await verifyExisting(destination, contentDigest)
        return { key, created: false }
      } finally {
        await rm(temporary, { force: true })
      }
    },

    async read(key: string): Promise<Uint8Array> {
      return readFile(storagePath(root, key))
    },

    async remove(key: string): Promise<void> {
      await rm(storagePath(root, key), { force: true })
    },
  }
}
