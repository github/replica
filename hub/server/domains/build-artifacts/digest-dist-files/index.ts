import { createHash } from "node:crypto"

import type { BuildPackageFile } from "../types.ts"

/**
 * Returns the dist package identity shared with the build action's digest-dist-package:
 * SHA-256 over sorted `name\0sha256(bytes)\n` lines for dist files and templates.json.
 */
export function digestDistFiles(files: BuildPackageFile[]): string {
  const lines = files
    .filter((file) => file.kind !== "screenshot")
    .map((file) => ({
      name: file.path,
      digest: createHash("sha256").update(file.bytes).digest("hex"),
    }))
    .sort((left, right) => (left.name < right.name ? -1 : 1))
  const digest = createHash("sha256")
  for (const line of lines) digest.update(`${line.name}\0${line.digest}\n`)
  return `sha256:${digest.digest("hex")}`
}
