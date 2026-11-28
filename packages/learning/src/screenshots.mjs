import { createHash, randomBytes } from "node:crypto"
import { constants, lstatSync, mkdirSync } from "node:fs"
import { open, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { canonicalJson } from "./canonical-json.mjs"
import { LearningError } from "./errors.mjs"
import { NO_FOLLOW, assertOwnPath, openError } from "./providers/files.mjs"

/** The most bytes one screenshot may hold, so a report cannot fill the disk. */
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024
/** The most screenshot bytes one usage report may hold, so a report cannot exhaust memory. */
export const MAX_REPORT_SCREENSHOT_BYTES = 100 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const DIGEST = /^sha256:[0-9a-f]{64}$/

/** The SHA-256 a screenshot record names for these bytes. */
export function screenshotDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

/** Refuse bytes that are not one PNG within the size limit. */
export function assertScreenshot(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array))
    throw new LearningError("invalid_input", "A screenshot must be PNG bytes.")
  if (bytes.length > MAX_SCREENSHOT_BYTES)
    throw new LearningError("invalid_input", "A screenshot can be at most 10 MB.")
  if (!PNG_SIGNATURE.equals(Buffer.from(bytes.subarray(0, PNG_SIGNATURE.length))))
    throw new LearningError("invalid_input", "A screenshot must be a PNG image.")
}

/**
 * Keep screenshot bytes on this machine, named by their SHA-256, in a private directory. The
 * learning records hold only the digest, so the same image is stored once, a deleted record
 * can take its image with it, and a damaged file is found when it is read.
 * Repositories can share one directory, so each one that stores an image leaves
 * an empty marker beside it, and the image goes only when no other repository's
 * marker is left.
 *
 * @param {string} directory where the images live, such as <data directory>/evidence
 */
export function createScreenshotStore(directory) {
  const root = path.resolve(directory)

  function fileFor(digest) {
    if (!DIGEST.test(digest ?? ""))
      throw new LearningError("invalid_input", "A screenshot is named by its sha256 digest.")
    return path.join(root, `${digest.slice("sha256:".length)}.png`)
  }

  function markerFor(digest, scope) {
    const owner = createHash("sha256").update(canonicalJson(scope)).digest("hex").slice(0, 32)
    return path.join(root, `${digest.slice("sha256:".length)}.${owner}.owner`)
  }

  /** True when any repository's marker still claims the image. */
  async function marked(digest) {
    const prefix = `${digest.slice("sha256:".length)}.`
    const names = await readdir(root).catch((error) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    return names.some((name) => name.startsWith(prefix) && name.endsWith(".owner"))
  }

  function ensureRoot() {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    assertOwnPath(path.dirname(root), root, lstatSync(root), { directory: true })
  }

  /** The stored bytes, or null when they are gone. Refuses bytes that no longer match. */
  async function read(digest) {
    const target = fileFor(digest)
    let handle
    try {
      handle = await open(target, constants.O_RDONLY | NO_FOLLOW)
    } catch (error) {
      if (error.code === "ENOENT") return null
      throw openError(root, target, error)
    }
    try {
      assertOwnPath(root, target, await handle.stat())
      const bytes = await handle.readFile()
      if (screenshotDigest(bytes) !== digest)
        throw new LearningError(
          "storage_corrupt",
          `The screenshot stored for ${digest} has other bytes.`,
        )
      return bytes
    } finally {
      await handle.close()
    }
  }

  return {
    /** Keep the bytes for a repository, once per digest, and return the digest. */
    async put(bytes, scope) {
      assertScreenshot(bytes)
      const digest = screenshotDigest(bytes)
      ensureRoot()
      // The marker comes before the image check; remove relies on that order.
      const marker = markerFor(digest, scope)
      try {
        await (
          await open(marker, constants.O_WRONLY | constants.O_CREAT | NO_FOLLOW, 0o600)
        ).close()
      } catch (error) {
        throw openError(root, marker, error)
      }
      const target = fileFor(digest)
      const existing = lstatSync(target, { throwIfNoEntry: false })
      if (existing) {
        assertOwnPath(root, target, existing)
        // A damaged file would make every later reference unreadable, so it is replaced.
        const kept = await read(digest).catch((error) => {
          if (error.code !== "storage_corrupt") throw error
          return null
        })
        if (kept) return digest
      }
      // Write a private temporary file, then rename it, so a reader never sees half an image.
      const temporary = path.join(root, `.${randomBytes(8).toString("hex")}.tmp`)
      let handle
      try {
        handle = await open(
          temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
          0o600,
        )
        await handle.writeFile(bytes)
        await handle.sync()
      } catch (error) {
        await rm(temporary, { force: true })
        throw openError(root, temporary, error)
      } finally {
        await handle?.close()
      }
      await rename(temporary, target)
      return digest
    },

    read,

    /**
     * Drop the markers of these scopes, which belong to one repository, and
     * remove the bytes when no other repository marks them. A digest with no
     * file is already removed.
     */
    async remove(digest, scopes) {
      const target = fileFor(digest)
      for (const scope of scopes) {
        const marker = markerFor(digest, scope)
        const kind = lstatSync(marker, { throwIfNoEntry: false })
        if (!kind) continue
        assertOwnPath(root, marker, kind)
        await rm(marker)
      }
      if (await marked(digest)) return
      const existing = lstatSync(target, { throwIfNoEntry: false })
      if (!existing) return
      assertOwnPath(root, target, existing)
      // Another process may store the image between the check above and the delete.
      // Moving the image aside first means a put that found it has already left its
      // marker for the second check, and a later put finds no image and writes one.
      const aside = path.join(root, `.${randomBytes(8).toString("hex")}.removing`)
      try {
        await rename(target, aside)
      } catch (error) {
        if (error.code === "ENOENT") return
        throw error
      }
      if (await marked(digest)) await rename(aside, target)
      else await rm(aside)
    },
  }
}

/**
 * For a hosted store, where the host keeps screenshot bytes in its own storage. The store
 * still checks each image and records its digest, but keeps no bytes, so a report with
 * screenshots needs an active screenshot consent grant the host recorded.
 */
export function createHostKeptScreenshotStore() {
  return {
    requiresGrant: true,
    async put(bytes) {
      assertScreenshot(bytes)
      return screenshotDigest(bytes)
    },
    async read() {
      return null
    },
    async remove() {},
  }
}
