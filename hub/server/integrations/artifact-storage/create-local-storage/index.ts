import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { constants } from "node:fs"
import { link, lstat, mkdir, open, realpath, rm, unlink } from "node:fs/promises"
import path from "node:path"

import type { ArtifactStorage, StoredArtifact } from "#server/integrations/artifact-storage/types"

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === code
  )
}

function rejectSymbolicLink(): never {
  throw new Error("Artifact storage paths cannot contain symbolic links.")
}

function artifactKey(contentDigest: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(contentDigest)) {
    throw new Error("Artifact content digest is invalid.")
  }
  const digest = contentDigest.slice("sha256:".length)
  return path.posix.join("sha256", digest.slice(0, 2), digest)
}

function parseArtifactKey(key: string) {
  const match = /^sha256\/([a-f0-9]{2})\/([a-f0-9]{64})$/.exec(key)
  if (!match?.[1] || !match[2] || match[2].slice(0, 2) !== match[1]) {
    throw new Error("Artifact storage key is invalid.")
  }
  return { shard: match[1], digest: match[2] }
}

function calculateContentDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

async function secureRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const status = await lstat(root)
  if (status.isSymbolicLink()) rejectSymbolicLink()
  if (!status.isDirectory()) throw new Error("Artifact storage root must be a directory.")
  return realpath(root)
}

async function secureDirectory(
  root: string,
  parent: string,
  name: string,
  create: boolean,
): Promise<string> {
  const candidate = path.join(parent, name)
  if (create) {
    try {
      await mkdir(candidate, { mode: 0o700 })
    } catch (error) {
      if (!isFileSystemError(error, "EEXIST")) throw error
    }
  }
  const status = await lstat(candidate)
  if (status.isSymbolicLink()) rejectSymbolicLink()
  if (!status.isDirectory()) throw new Error("Artifact storage path is not a directory.")
  const resolved = await realpath(candidate)
  if (!isWithinRoot(root, resolved)) {
    throw new Error("Artifact storage path escapes its root.")
  }
  return resolved
}

async function resolveArtifactPath(root: string, key: string, createDirectories: boolean) {
  const { shard, digest } = parseArtifactKey(key)
  const resolvedRoot = await secureRoot(root)
  const algorithmDirectory = await secureDirectory(
    resolvedRoot,
    resolvedRoot,
    "sha256",
    createDirectories,
  )
  const shardDirectory = await secureDirectory(
    resolvedRoot,
    algorithmDirectory,
    shard,
    createDirectories,
  )
  const destination = path.join(shardDirectory, digest)
  if (!isWithinRoot(resolvedRoot, destination)) {
    throw new Error("Artifact storage path escapes its root.")
  }
  return { destination, resolvedRoot }
}

async function validateArtifactPath(resolvedRoot: string, destination: string) {
  const status = await lstat(destination)
  if (status.isSymbolicLink()) rejectSymbolicLink()
  if (!status.isFile()) throw new Error("Artifact storage path is not a file.")
  const resolved = await realpath(destination)
  if (!isWithinRoot(resolvedRoot, resolved)) {
    throw new Error("Artifact storage path escapes its root.")
  }
}

async function openArtifact(resolvedRoot: string, destination: string) {
  await validateArtifactPath(resolvedRoot, destination)
  return open(destination, constants.O_RDONLY | constants.O_NOFOLLOW)
}

async function verifyExisting(
  resolvedRoot: string,
  destination: string,
  contentDigest: string,
): Promise<void> {
  const file = await openArtifact(resolvedRoot, destination)
  try {
    const expected = Buffer.from(contentDigest.slice("sha256:".length), "hex")
    const actual = createHash("sha256")
      .update(await file.readFile())
      .digest()
    if (!timingSafeEqual(expected, actual)) {
      throw new Error("Stored artifact content does not match its key.")
    }
  } finally {
    await file.close()
  }
}

async function syncDirectoryChain(directory: string): Promise<void> {
  let current = directory
  while (true) {
    const handle = await open(current, constants.O_RDONLY | constants.O_DIRECTORY)
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
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
      const { destination, resolvedRoot } = await resolveArtifactPath(root, key, true)
      try {
        await verifyExisting(resolvedRoot, destination, contentDigest)
        await syncDirectoryChain(path.dirname(destination))
        return { key, created: false }
      } catch (error) {
        if (!isFileSystemError(error, "ENOENT")) throw error
      }

      const temporary = `${destination}.${randomUUID()}.tmp`
      const file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      try {
        try {
          await file.writeFile(bytes)
          await file.sync()
        } finally {
          await file.close()
        }
        try {
          const resolved = await resolveArtifactPath(root, key, false)
          if (resolved.destination !== destination) {
            throw new Error("Artifact storage path changed during the write.")
          }
          await link(temporary, destination)
          await syncDirectoryChain(path.dirname(destination))
          return { key, created: true }
        } catch (error) {
          if (!isFileSystemError(error, "EEXIST")) throw error
          await verifyExisting(resolvedRoot, destination, contentDigest)
          await syncDirectoryChain(path.dirname(destination))
          return { key, created: false }
        }
      } finally {
        await rm(temporary, { force: true })
      }
    },

    async read(key: string): Promise<Uint8Array> {
      const { destination, resolvedRoot } = await resolveArtifactPath(root, key, false)
      const file = await openArtifact(resolvedRoot, destination)
      try {
        return await file.readFile()
      } finally {
        await file.close()
      }
    },

    async remove(key: string): Promise<void> {
      try {
        const { destination, resolvedRoot } = await resolveArtifactPath(root, key, false)
        await validateArtifactPath(resolvedRoot, destination)
        await unlink(destination)
      } catch (error) {
        if (!isFileSystemError(error, "ENOENT")) throw error
      }
    },
  }
}
