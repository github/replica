import { lstat, opendir } from "node:fs/promises"
import path from "node:path"

import { validateOutputPath } from "../validate-output-path/index.ts"

export type BuildFileState = {
  entries: number
  files: { path: string; bytes: number }[]
  limits: {
    maxEntries: number
    maxFileBytes: number
    maxPathDepth: number
    maxTotalBytes: number
  }
  seenPaths: Map<string, string>
  totalBytes: number
}

/** Adds files from one directory to the list after checking count and size limits. */
export async function collectBuildFiles(
  directory: string,
  state: BuildFileState,
  parentPath = "",
): Promise<void> {
  const handle = await opendir(directory)

  for await (const entry of handle) {
    const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name
    const absolutePath = path.join(directory, entry.name)
    const details = await lstat(absolutePath)
    state.entries += 1

    if (state.entries > state.limits.maxEntries) {
      throw new Error(
        `Build output contains more than ${state.limits.maxEntries} files and directories.`,
      )
    }

    validateOutputPath(relativePath, state.seenPaths, state.limits.maxPathDepth)

    if (details.isDirectory()) {
      await collectBuildFiles(absolutePath, state, relativePath)
      continue
    }

    if (!details.isFile()) {
      throw new Error(
        `Build output may contain only files and directories. Remove this unsupported entry: ${relativePath}`,
      )
    }

    if (details.size > state.limits.maxFileBytes) {
      throw new Error(
        `Build output file must be no larger than ${state.limits.maxFileBytes} bytes: ${relativePath} has ${details.size} bytes.`,
      )
    }

    state.totalBytes += details.size

    if (state.totalBytes > state.limits.maxTotalBytes) {
      throw new Error(
        `Build output files must total no more than ${state.limits.maxTotalBytes} bytes; found ${state.totalBytes}.`,
      )
    }

    state.files.push({ path: relativePath, bytes: details.size })
  }
}
