import { rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { copyScreenshots } from "../copy-screenshots/index.mjs"
import { digestDistPackage } from "../digest-dist-package/index.mjs"
import { readTemplates } from "../read-templates/index.mjs"
import { requiredPathArgument } from "../required-path-argument/index.mjs"

/** Packages checked screenshots with the digest of the dist package they depict. */
export async function createScreenshotPackage(screenshots, distPackage, output) {
  const manifest = await readTemplates(distPackage, "templates.json")
  const distDigest = await digestDistPackage(distPackage)

  await rm(output, { force: true, recursive: true })
  const bytes = await copyScreenshots(screenshots, manifest, path.join(output, "screenshots"))
  await writeFile(path.join(output, "screenshots.json"), JSON.stringify({ version: 1, distDigest }))

  return { bytes, distDigest }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { distDigest } = await createScreenshotPackage(
    requiredPathArgument("screenshots"),
    requiredPathArgument("dist-package"),
    requiredPathArgument("output"),
  )
  console.log(`Created Replica screenshot package for ${distDigest}.`)
}
