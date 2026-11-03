import { lstat } from "node:fs/promises"
import path from "node:path"

/** Checks that the configured output contains an index.html file. */
export async function requireIndexFile(dist: string, outputDirectory = "dist") {
  let details

  try {
    details = await lstat(path.join(dist, "index.html"))
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      throw new Error(`Build must contain ${outputDirectory}/index.html.`, { cause: error })
    }

    throw error
  }

  if (!details.isFile()) {
    throw new Error(
      `Build ${outputDirectory}/index.html must be a file. Symbolic links and directories are not allowed.`,
    )
  }
}
