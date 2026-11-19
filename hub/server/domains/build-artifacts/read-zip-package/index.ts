import { readZipArchive } from "../../../utils/read-zip-archive/index.ts"
import { ZipArchiveError } from "../../../utils/read-zip-archive/errors.ts"
import {
  maximumBuildPackageEntries,
  maximumDistFileBytes,
  maximumExtractedBytes,
  maximumScreenshotBytes,
  maximumTemplateManifestBytes,
} from "../constants.ts"
import { BuildPackageError } from "../errors.ts"
import { normalizeBuildArtifactPath } from "../normalize-build-artifact-path/index.ts"

function maximumEntryBytes(name: string) {
  if (name === "templates.json") return maximumTemplateManifestBytes
  if (name === "screenshots.json") return 1_024
  return name.startsWith("screenshots/") ? maximumScreenshotBytes : maximumDistFileBytes
}

/** Reads a downloaded Build artifact ZIP into normalized, bounded files. */
export function readZipPackage(archive: Buffer) {
  let entries
  try {
    entries = readZipArchive(archive, {
      maximumEntries: maximumBuildPackageEntries,
      maximumEntryBytes,
      maximumTotalBytes: maximumExtractedBytes,
    })
  } catch (error) {
    if (error instanceof ZipArchiveError) throw new BuildPackageError(error.message)
    throw error
  }
  return entries.map(({ name, bytes }) => {
    const path = normalizeBuildArtifactPath(name)
    if (!path) throw new BuildPackageError("The package contains an unsafe file path.")
    return { path, bytes }
  })
}
