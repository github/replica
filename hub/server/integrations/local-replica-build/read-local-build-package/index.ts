import { lstat, opendir, readFile } from "node:fs/promises"
import path from "node:path"

import type { LocalBuildPackageFile } from "./types.ts"

export async function readLocalBuildPackage(
  packageDirectory: string,
): Promise<LocalBuildPackageFile[]> {
  const files: LocalBuildPackageFile[] = []

  async function visit(directory: string, parentPath = "") {
    const handle = await opendir(directory)
    for await (const entry of handle) {
      const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name
      const absolutePath = path.join(directory, entry.name)
      const details = await lstat(absolutePath)
      if (details.isDirectory()) {
        await visit(absolutePath, relativePath)
        continue
      }
      if (!details.isFile()) throw new Error("Replica packages may contain only regular files.")
      const kind = relativePath.startsWith("dist/")
        ? "dist"
        : relativePath.startsWith("screenshots/")
          ? "screenshot"
          : relativePath === "templates.json"
            ? "manifest"
            : null
      if (!kind) throw new Error("Replica package contains an unexpected file.")
      files.push({ path: relativePath, kind, bytes: await readFile(absolutePath) })
    }
  }

  await visit(packageDirectory)
  files.sort((first, second) => first.path.localeCompare(second.path))
  return files
}
