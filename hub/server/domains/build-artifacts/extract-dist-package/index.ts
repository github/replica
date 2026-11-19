import { maximumDistFiles, maximumDistPathDepth, pngSignature, screenshotPathPattern } from "../constants.ts"
import { digestDistFiles } from "../digest-dist-files/index.ts"
import { BuildPackageError } from "../errors.ts"
import { readZipPackage } from "../read-zip-package/index.ts"
import type { BuildPackageFile } from "../types.ts"
import { validateBuildTemplates } from "../validate-build-templates/index.ts"

function classify(path: string, bytes: Buffer): BuildPackageFile {
  if (path.startsWith("dist/")) {
    if (path.split("/").length - 1 > maximumDistPathDepth) {
      throw new BuildPackageError(`${path} is nested too deeply.`)
    }
    return { path, kind: "dist", bytes }
  }
  if (path === "templates.json") {
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    } catch {
      throw new BuildPackageError("templates.json must contain correctly formatted JSON.")
    }
    validateBuildTemplates(value)
    return { path, kind: "manifest", bytes }
  }
  // Packages from earlier action versions carried screenshots alongside the dist files.
  if (screenshotPathPattern.test(path)) {
    if (!bytes.subarray(0, 8).equals(pngSignature)) {
      throw new BuildPackageError(`${path} is not a PNG image.`)
    }
    return { path, kind: "screenshot", bytes }
  }
  throw new BuildPackageError(`The package contains an unexpected file: ${path}.`)
}

/** Validates a replica-build-v1 ZIP and returns its files and dist digest. */
export function extractDistPackage(archive: Buffer) {
  const files = readZipPackage(archive).map(({ path, bytes }) => classify(path, bytes))
  if (files.filter((file) => file.kind === "dist").length > maximumDistFiles) {
    throw new BuildPackageError(`The package contains more than ${maximumDistFiles} dist files.`)
  }
  if (!files.some((file) => file.path === "dist/index.html")) {
    throw new BuildPackageError("The package does not contain dist/index.html.")
  }
  files.sort((left, right) => (left.path < right.path ? -1 : 1))
  return { files, distDigest: digestDistFiles(files) }
}
