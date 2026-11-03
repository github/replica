import { constants } from "node:fs"
import { open } from "node:fs/promises"

export async function withArtifactDirectory<T>(
  directory: string,
  operation: (path: string) => Promise<T>,
): Promise<T> {
  if (
    process.platform !== "linux" ||
    !directory.startsWith("/") ||
    directory.includes("\0") ||
    directory.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Artifact directory is unavailable.")
  }
  let handle = await open("/", constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    // Pinned directory descriptors prevent ancestor replacement from following a symlink.
    for (const part of directory.split("/").filter(Boolean)) {
      const next = await open(
        `/proc/self/fd/${handle.fd}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      ).catch(() => {
        throw new Error("Artifact directory is unavailable.")
      })
      await handle.close()
      handle = next
    }
    return await operation(`/proc/self/fd/${handle.fd}`)
  } finally {
    await handle.close()
  }
}
