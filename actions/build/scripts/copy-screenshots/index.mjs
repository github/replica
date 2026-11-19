import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  MAX_PACKAGE_BYTES,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_HEIGHT,
  VIEWPORTS,
} from "../constants.mjs"
import { pngDimensions } from "../png-dimensions/index.mjs"

/** Checks the expected screenshot set and copies it, returning the bytes copied. */
export async function copyScreenshots(screenshots, manifest, output, { usedBytes = 0 } = {}) {
  let totalBytes = usedBytes
  await mkdir(output, { recursive: true })

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
        if (error.code === "ENOENT") return false
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

        const destination = path.join(output, name)
        await mkdir(path.dirname(destination), { recursive: true })
        await writeFile(destination, bytes)
      }
    }
  }

  return totalBytes - usedBytes
}
