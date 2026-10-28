import { lstat } from "node:fs/promises"
import path from "node:path"

/** Checks that a required repository-root path is a file and not a symbolic link. */
export async function requireFile(root: string, name: string) {
  let details

  try {
    details = await lstat(path.join(root, name))
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      throw new Error(`Repository must contain ${name} at its root.`, { cause: error })
    }

    throw error
  }

  if (!details.isFile()) {
    throw new Error(
      `Repository ${name} must be a file. Symbolic links and directories are not allowed.`,
    )
  }
}
