import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  MAX_PACKAGE_BYTES,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_HEIGHT,
  VIEWPORTS,
} from "../constants.ts"
import { pngDimensions } from "../png-dimensions/index.ts"
import { readTemplates } from "../read-templates/index.ts"
import { requiredPathArgument } from "../required-path-argument/index.ts"
import { validateBuildOutput } from "../validate-build-output/index.ts"

/** Copies checked dist files and screenshots into the upload directory. */
export async function createPackage(root: string, screenshots: string, output: string) {
  const buildOutput = await validateBuildOutput(root)
  const manifest = await readTemplates(screenshots, "templates.json")
  let totalBytes = buildOutput.bytes

  await rm(output, { force: true, recursive: true })
  await mkdir(path.join(output, "dist"), { recursive: true })
  await mkdir(path.join(output, "screenshots"), { recursive: true })

  for (const file of buildOutput.files) {
    const bytes = await readFile(path.join(root, "dist", file.path))
    const destination = path.join(output, "dist", file.path)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, bytes)
  }

  const directories = [
    "",
    ...(manifest?.templates.map((template) => `templates/${template.id}`) ?? []),
  ]
  const darkNames = directories.flatMap((directory) =>
    VIEWPORTS.map((viewport) => path.posix.join(directory, `${viewport.name}-dark.png`)),
  )
  const darkPresent = await Promise.all(
    darkNames.map(async (name) => {
      try {
        await access(path.join(screenshots, name))
        return true
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
        throw error
      }
    }),
  )
  const hasDarkScreenshots = darkPresent.some(Boolean)
  if (hasDarkScreenshots && !darkPresent.every(Boolean)) {
    throw new Error(
      `Package is missing dark screenshots: ${darkNames.filter((_, index) => !darkPresent[index]).join(", ")}.`,
    )
  }
  for (const directory of directories) {
    for (const viewport of VIEWPORTS) {
      for (const suffix of hasDarkScreenshots ? ["", "-dark"] : [""]) {
        const name = path.posix.join(directory, `${viewport.name}${suffix}.png`)
        const bytes = await readFile(path.join(screenshots, name))

        if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES) {
          throw new Error(
            `Screenshot ${name} must be between 1 and ${MAX_SCREENSHOT_BYTES} bytes; found ${bytes.length}.`,
          )
        }

        const dimensions = pngDimensions(bytes, name, viewport.width, MAX_SCREENSHOT_HEIGHT)

        if (dimensions.width !== viewport.width || dimensions.height < viewport.height) {
          throw new Error(
            `Screenshot ${name} must be ${viewport.width} pixels wide and at least ${viewport.height} pixels high; found ${dimensions.width} by ${dimensions.height}.`,
          )
        }

        totalBytes += bytes.length
        if (totalBytes > MAX_PACKAGE_BYTES) {
          throw new Error("Replica package files total more than 150 MiB.")
        }

        const destination = path.join(output, "screenshots", name)
        await mkdir(path.dirname(destination), { recursive: true })
        await writeFile(destination, bytes)
      }
    }
  }

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
