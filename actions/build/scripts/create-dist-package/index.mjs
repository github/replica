import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { MAX_PACKAGE_BYTES } from "../constants.mjs"
import { readTemplates } from "../read-templates/index.mjs"
import { requiredPathArgument } from "../required-path-argument/index.mjs"
import { validateBuildOutput } from "../validate-build-output/index.mjs"

/** Packages checked dist files and repository template metadata without screenshots. */
export async function createDistPackage(root, configRoot, output) {
  const buildOutput = await validateBuildOutput(root)
  const manifest = await readTemplates(configRoot)
  const manifestBytes = manifest ? JSON.stringify(manifest) : null
  if (buildOutput.bytes + Buffer.byteLength(manifestBytes ?? "") > MAX_PACKAGE_BYTES) {
    throw new Error("Replica package files total more than 150 MiB.")
  }

  await rm(output, { force: true, recursive: true })
  await mkdir(path.join(output, "dist"), { recursive: true })

  for (const file of buildOutput.files) {
    const bytes = await readFile(path.join(root, "dist", file.path))
    const destination = path.join(output, "dist", file.path)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, bytes)
  }

  if (manifestBytes) await writeFile(path.join(output, "templates.json"), manifestBytes)

  await validateBuildOutput(output)
  return buildOutput.files.length
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = await createDistPackage(
    requiredPathArgument("root"),
    requiredPathArgument("config-root"),
    requiredPathArgument("output"),
  )
  console.log(`Created Replica dist package with ${files} files.`)
}
