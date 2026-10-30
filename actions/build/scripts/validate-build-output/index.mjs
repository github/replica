import { lstat, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { collectBuildFiles } from "../collect-build-files/index.mjs"
import { MAX_ENTRIES, MAX_FILE_BYTES, MAX_PATH_DEPTH, MAX_TOTAL_BYTES } from "../constants.mjs"
import { requireIndexFile } from "../require-index-file/index.mjs"
import { requiredPathArgument } from "../required-path-argument/index.mjs"
import { validateControlsDocument } from "../../../../hub/app/utils/prototype-controls/controls.mjs"

const DEFAULT_LIMITS = {
  maxEntries: MAX_ENTRIES,
  maxFileBytes: MAX_FILE_BYTES,
  maxPathDepth: MAX_PATH_DEPTH,
  maxTotalBytes: MAX_TOTAL_BYTES,
}

/** Checks dist paths and sizes, then returns the files that can be packaged. */
export async function validateBuildOutput(root, limits = {}) {
  const appliedLimits = { ...DEFAULT_LIMITS, ...limits }
  const dist = path.join(root, "dist")
  let distDetails

  try {
    distDetails = await lstat(dist)
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      throw new Error("Build must contain a dist/ directory.", { cause: error })
    }

    throw error
  }

  if (!distDetails.isDirectory()) {
    throw new Error("Build dist/ must be a directory. Symbolic links and files are not allowed.")
  }

  await requireIndexFile(dist)

  const state = {
    entries: 0,
    files: [],
    limits: appliedLimits,
    seenPaths: new Map(),
    totalBytes: 0,
  }
  await collectBuildFiles(dist, state)
  const definitions = state.files.find((file) => file.path === "controls.replica.json")
  if (definitions) {
    const source = await readFile(path.join(dist, "controls.replica.json"), "utf8")
    if (Buffer.byteLength(source) > 256_000)
      throw new Error("controls.replica.json exceeds the 256,000-byte limit.")
    try {
      validateControlsDocument(JSON.parse(source))
    } catch (error) {
      throw new Error(`Build Controls are invalid: ${error.message}`, { cause: error })
    }
  }
  state.files.sort((left, right) => {
    if (left.path < right.path) return -1
    if (left.path > right.path) return 1
    return 0
  })

  return { bytes: state.totalBytes, files: state.files }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = await validateBuildOutput(requiredPathArgument("root"))
  console.log(`Checked dist/: ${output.files.length} files, ${output.bytes} bytes.`)
}
