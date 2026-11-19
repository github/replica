import { attachGitHubBuildScreenshots } from "../../../repositories/github-builds/attach-github-build-screenshots/index.ts"
import { readGitHubBuildPackageState } from "../../../repositories/github-builds/read-github-build-package-state/index.ts"
import { BuildPackageError } from "../../build-artifacts/errors.ts"
import { extractScreenshotPackage } from "../../build-artifacts/extract-screenshot-package/index.ts"
import { storeGitHubBuildFiles } from "../store-github-build-files/index.ts"
import type { GitHubBuildImportDependencies } from "../types.ts"

/** Stores screenshots and attaches them only when they depict the Build's dist. */
export async function importGitHubScreenshotPackage(
  dependencies: GitHubBuildImportDependencies,
  buildId: string,
  bytes: Buffer,
) {
  const { database, logger, storage } = dependencies
  let extracted
  try {
    extracted = extractScreenshotPackage(bytes)
  } catch (error) {
    if (!(error instanceof BuildPackageError)) throw error
    logger.warn({ buildId, reason: error.message }, "Screenshots rejected")
    return { status: "invalid" as const, reason: error.message }
  }
  const build = await readGitHubBuildPackageState(database, buildId)
  if (build?.state !== "successful") return { status: "not-ready" as const }
  if (build.distDigest !== extracted.distDigest) return { status: "digest-mismatch" as const }
  const artifacts = await storeGitHubBuildFiles(storage, buildId, extracted.files)
  const status = await attachGitHubBuildScreenshots(database, {
    buildId,
    distDigest: extracted.distDigest,
    artifacts,
  })
  return { status }
}
