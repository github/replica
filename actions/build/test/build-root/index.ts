import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { temporaryDirectory } from "../temporary-directory/index.ts"

/** Creates a temporary dist/ directory with the required index.html file. */
export async function buildRoot() {
  const root = await temporaryDirectory()
  await mkdir(path.join(root, "dist", "assets"), { recursive: true })
  await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
  return root
}
