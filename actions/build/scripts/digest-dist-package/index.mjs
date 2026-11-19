import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { readTemplates } from "../read-templates/index.mjs"
import { validateBuildOutput } from "../validate-build-output/index.mjs"

/** Returns a stable SHA-256 identity for a dist package's dist files and template metadata. */
export async function digestDistPackage(root) {
  const { files } = await validateBuildOutput(root)
  const entries = files.map((file) => ({
    name: `dist/${file.path.split(path.sep).join("/")}`,
    location: path.join(root, "dist", file.path),
  }))
  if (await readTemplates(root, "templates.json")) {
    entries.push({ name: "templates.json", location: path.join(root, "templates.json") })
  }

  const digest = createHash("sha256")
  for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const fileDigest = createHash("sha256")
      .update(await readFile(entry.location))
      .digest("hex")
    digest.update(`${entry.name}\0${fileDigest}\n`)
  }

  return `sha256:${digest.digest("hex")}`
}
