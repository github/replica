import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { join } from "node:path"

import { previewStorageKeyPattern } from "../../../domains/private-preview/types.ts"
import { withArtifactDirectory } from "../with-artifact-directory/index.ts"

export function createPrivateArtifactReader(directory: string) {
  return async (key: string, length: number, signal: AbortSignal) => {
    if (!previewStorageKeyPattern.test(key)) return { status: "unavailable" } as const
    async function read(root: string) {
      signal.throwIfAborted()
      const handle = await open(
        join(root, key),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size !== length) return { status: "unavailable" } as const
        const bytes = Buffer.alloc(length)
        let offset = 0
        while (offset < length) {
          signal.throwIfAborted()
          const result = await handle.read(bytes, offset, length - offset, offset)
          if (!result.bytesRead) return { status: "unavailable" } as const
          offset += result.bytesRead
        }
        return { status: "ok", bytes } as const
      } finally {
        await handle.close()
      }
    }
    try {
      // Linux pins each ancestor; local non-Linux use requires a trusted directory.
      return process.platform === "linux"
        ? await withArtifactDirectory(directory, read)
        : await read(directory)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { status: "not-found" } as const
      }
      return { status: "unavailable" } as const
    }
  }
}
