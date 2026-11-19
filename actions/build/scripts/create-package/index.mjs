import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { MAX_PACKAGE_BYTES } from "../constants.mjs"
import { copyScreenshots } from "../copy-screenshots/index.mjs"
import { readTemplates } from "../read-templates/index.mjs"
import { requiredPathArgument } from "../required-path-argument/index.mjs"
import { validateBuildOutput } from "../validate-build-output/index.mjs"

/** Copies checked dist files and screenshots into the upload directory. */
export async function createPackage(root, screenshots, output) {
  const buildOutput = await validateBuildOutput(root)
  const manifest = await readTemplates(screenshots, "templates.json")
  let totalBytes = buildOutput.bytes

  await rm(output, { force: true, recursive: true })
  await mkdir(path.join(output, "dist"), { recursive: true })

  for (const file of buildOutput.files) {
    const bytes = await readFile(path.join(root, "dist", file.path))
    const destination = path.join(output, "dist", file.path)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, bytes)
  }

  totalBytes += await copyScreenshots(screenshots, manifest, path.join(output, "screenshots"), {
    usedBytes: totalBytes,
  })

  if (manifest) {
    const bytes = JSON.stringify(manifest)
    if (totalBytes + Buffer.byteLength(bytes) > MAX_PACKAGE_BYTES) {
      throw new Error("Replica package files total more than 150 MiB.")
    }
    await writeFile(path.join(output, "templates.json"), bytes)
  }

  return buildOutput.files.length
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = await createPackage(
    requiredPathArgument("root"),
    requiredPathArgument("screenshots"),
    requiredPathArgument("output"),
  )
  console.log(`Created Replica package with ${files} dist files.`)
}
