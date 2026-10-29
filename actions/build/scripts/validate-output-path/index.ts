import { unsupportedPathSegment } from "../unsupported-path-segment/index.ts"

/** Checks one dist path and records it for duplicate-name checks. */
export function validateOutputPath(
  relativePath: string,
  seenPaths: Map<string, string>,
  maxPathDepth: number,
) {
  const parts = relativePath.split("/")

  if (relativePath.includes("\\")) {
    throw new Error(`Build output path must use forward slashes: ${relativePath}`)
  }

  if (parts.includes("..")) {
    throw new Error(`Build output path must not contain parent-directory segments: ${relativePath}`)
  }

  if (parts.length > maxPathDepth) {
    throw new Error(
      `Build output path exceeds the maximum depth of ${maxPathDepth}: ${relativePath}`,
    )
  }

  if (parts.some((part) => unsupportedPathSegment(part))) {
    throw new Error(
      `Build output path must use printable ASCII names that work on Windows and Unix: ${relativePath}`,
    )
  }

  const foldedPath = relativePath.toLowerCase()
  const existingPath = seenPaths.get(foldedPath)

  if (existingPath && existingPath !== relativePath) {
    throw new Error(
      `Build output paths differ only by letter case and cannot both be packaged: ${existingPath}, ${relativePath}`,
    )
  }

  seenPaths.set(foldedPath, relativePath)
}
