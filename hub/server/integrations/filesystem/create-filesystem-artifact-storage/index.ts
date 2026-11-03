import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { link, lstat, open, unlink } from "node:fs/promises"

import { withArtifactDirectory } from "../with-artifact-directory/index.ts"
import type { FilesystemArtifactStorage } from "./types.ts"

export async function createFilesystemArtifactStorage(
  directory: string,
  maxBytes: number,
): Promise<FilesystemArtifactStorage> {
  try {
    await withArtifactDirectory(directory, () => Promise.resolve(undefined))
  } catch {
    throw new Error("Artifact directory is unavailable.")
  }
  return {
    async read(key) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(key)) return { status: "unavailable" }
      try {
        return await withArtifactDirectory(directory, async (path) => {
          const handle = await open(
            `${path}/${key}`,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          )
          try {
            const stat = await handle.stat()
            if (!stat.isFile()) return { status: "unavailable" } as const
            if (stat.size > maxBytes) return { status: "too-large" } as const
            const bytes = new Uint8Array(stat.size + 1)
            let length = 0
            while (length < bytes.length) {
              const { bytesRead } = await handle.read(bytes, length, bytes.length - length)
              if (!bytesRead) break
              length += bytesRead
            }
            if (length > stat.size) return { status: "unavailable" } as const
            return { status: "ok", bytes: bytes.slice(0, length) } as const
          } finally {
            await handle.close()
          }
        })
      } catch (error) {
        return {
          status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "not-found" : "unavailable",
        }
      }
    },
    async write(key, bytes) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(key) || bytes.length > maxBytes) {
        return { status: "unavailable" }
      }
      try {
        return await withArtifactDirectory(directory, async (path) => {
          const staging = `${path}/.${randomUUID()}`
          const handle = await open(
            staging,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o600,
          )
          try {
            await handle.writeFile(bytes)
            await handle.sync()
            await handle.close()
            // Publishing the completed file with link() atomically refuses existing keys.
            await link(staging, `${path}/${key}`)
            return { status: "ok" } as const
          } finally {
            await handle.close()
            await unlink(staging)
          }
        })
      } catch (error) {
        return {
          status:
            (error as NodeJS.ErrnoException).code === "EEXIST" ? "already-exists" : "unavailable",
        }
      }
    },
    async delete(key) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(key)) return { status: "unavailable" }
      try {
        return await withArtifactDirectory(directory, async (path) => {
          if (!(await lstat(`${path}/${key}`)).isFile()) {
            return { status: "unavailable" } as const
          }
          await unlink(`${path}/${key}`)
          return { status: "ok" } as const
        })
      } catch (error) {
        return {
          status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "not-found" : "unavailable",
        }
      }
    },
  }
}
