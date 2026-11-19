import { distDigestPattern, pngSignature, screenshotPathPattern } from "../constants.ts"
import { BuildPackageError } from "../errors.ts"
import { readZipPackage } from "../read-zip-package/index.ts"
import type { BuildPackageFile } from "../types.ts"

function readManifest(bytes: Buffer | undefined) {
  if (!bytes) throw new BuildPackageError("The screenshot package has no screenshots.json.")
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new BuildPackageError("screenshots.json must contain correctly formatted JSON.")
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "distDigest,version" ||
    (value as { version?: unknown }).version !== 1 ||
    typeof (value as { distDigest?: unknown }).distDigest !== "string" ||
    !distDigestPattern.test((value as { distDigest: string }).distDigest)
  ) {
    throw new BuildPackageError("screenshots.json must be a version 1 manifest with a dist digest.")
  }
  return (value as { distDigest: string }).distDigest
}

/** Validates a replica-screenshots-v1 ZIP and returns the dist digest it depicts. */
export function extractScreenshotPackage(archive: Buffer) {
  const entries = readZipPackage(archive)
  const distDigest = readManifest(entries.find((entry) => entry.path === "screenshots.json")?.bytes)
  const files: BuildPackageFile[] = []
  for (const { path, bytes } of entries) {
    if (path === "screenshots.json") continue
    if (!screenshotPathPattern.test(path)) {
      throw new BuildPackageError(`The screenshot package contains an unexpected file: ${path}.`)
    }
    if (!bytes.subarray(0, 8).equals(pngSignature)) {
      throw new BuildPackageError(`${path} is not a PNG image.`)
    }
    files.push({ path, kind: "screenshot", bytes })
  }
  if (files.length === 0) throw new BuildPackageError("The screenshot package has no screenshots.")
  return { distDigest, files }
}
