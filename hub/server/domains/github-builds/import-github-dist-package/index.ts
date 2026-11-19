import { completeGitHubBuildFailure } from "../../../repositories/github-builds/complete-github-build-failure/index.ts"
import { completeGitHubBuildSuccess } from "../../../repositories/github-builds/complete-github-build-success/index.ts"
import { BuildPackageError } from "../../build-artifacts/errors.ts"
import { extractDistPackage } from "../../build-artifacts/extract-dist-package/index.ts"
import { storeGitHubBuildFiles } from "../store-github-build-files/index.ts"
import type { GitHubBuildRun } from "../../../repositories/github-builds/types.ts"
import type { GitHubBuildImportDependencies } from "../types.ts"

/**
 * Stores a dist package for the run's Build and marks it successful. An invalid package
 * fails the Build; storage keys are write-once, so a retried import is harmless.
 */
export async function importGitHubDistPackage(
  dependencies: GitHubBuildImportDependencies,
  target: {
    buildId: string
    run: GitHubBuildRun
    completedAt: Date | null
    /** Rejects the package before storage unless its dist has this digest. */
    expectedDistDigest?: string
  },
  bytes: Buffer,
) {
  const { database, logger, storage } = dependencies
  const { buildId, run } = target
  let extracted
  try {
    extracted = extractDistPackage(bytes)
  } catch (error) {
    if (!(error instanceof BuildPackageError)) throw error
    await completeGitHubBuildFailure(database, {
      buildId,
      run,
      completedAt: target.completedAt,
      failureSummary: error.message,
    })
    logger.warn(
      { buildId, runId: run.runId, failureSummary: error.message },
      "GitHub Build import failed",
    )
    return { status: "failed" as const, reason: error.message }
  }
  if (target.expectedDistDigest && extracted.distDigest !== target.expectedDistDigest) {
    return { status: "digest-mismatch" as const }
  }
  const artifacts = await storeGitHubBuildFiles(storage, buildId, extracted.files)
  const imported = await completeGitHubBuildSuccess(database, {
    buildId,
    run,
    distDigest: extracted.distDigest,
    artifacts,
  })
  if (imported) logger.info({ buildId, runId: run.runId }, "GitHub Build imported")
  return { status: imported ? ("imported" as const) : ("unchanged" as const) }
}
