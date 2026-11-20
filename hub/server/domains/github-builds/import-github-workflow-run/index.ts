import { completeGitHubBuildFailure } from "../../../repositories/github-builds/complete-github-build-failure/index.ts"
import { markGitHubBuildRunning } from "../../../repositories/github-builds/mark-github-build-running/index.ts"
import { recordGitHubBuildRunCompletion } from "../../../repositories/github-builds/record-github-build-run-completion/index.ts"
import { settleDeselectedGitHubBuild } from "../../../repositories/github-builds/settle-deselected-github-build/index.ts"
import { findConnectedGitHubRepository } from "../../../repositories/repository-access/find-connected-github-repository/index.ts"
import { BuildPackageError } from "../../build-artifacts/errors.ts"
import { extractScreenshotPackage } from "../../build-artifacts/extract-screenshot-package/index.ts"
import { registerImportedPrototype } from "../../prototypes/register-imported-prototype/index.ts"
import type {
  GitHubWorkflowArtifact,
  GitHubWorkflowRun,
} from "../../../integrations/github/create-github-actions-client/types.ts"
import { GitHubCommitLookupError } from "../../../integrations/github/errors.ts"
import {
  distArtifactName,
  maximumArtifactDownloadBytes,
  screenshotArtifactName,
} from "../constants.ts"
import type { GitHubWorkflowRunJob } from "../get-github-workflow-run-job-definition/index.ts"
import { importGitHubDistPackage } from "../import-github-dist-package/index.ts"
import { importGitHubScreenshotPackage } from "../import-github-screenshot-package/index.ts"
import { isGitHubWorkflowBranchPush } from "../is-github-workflow-branch-push/index.ts"
import { prepareGitHubWorkflowRunBuild } from "../prepare-github-workflow-run-build/index.ts"
import type { ImportGitHubWorkflowRunDependencies, ImportGitHubWorkflowRunResult } from "./types.ts"

/** Splits retained artifacts into this attempt's newest and an earlier attempt's newest. */
function byAttempt(artifacts: GitHubWorkflowArtifact[], run: GitHubWorkflowRun) {
  const retained = artifacts.filter((artifact) => !artifact.expired).sort((a, b) => b.id - a.id)
  function isCurrent(artifact: GitHubWorkflowArtifact) {
    return !run.startedAt || (!!artifact.createdAt && artifact.createdAt >= run.startedAt)
  }
  return {
    current: retained.find(isCurrent),
    earlier: retained.find((artifact) => !isCurrent(artifact)),
  }
}

/**
 * Imports available artifacts when a workflow event queues a pass. Separate jobs
 * let dist import before screenshot capture finishes.
 * Transient errors throw so the job retries; invalid packages fail the Build.
 */
export async function importGitHubWorkflowRun(
  dependencies: ImportGitHubWorkflowRunDependencies,
  job: GitHubWorkflowRunJob,
): Promise<ImportGitHubWorkflowRunResult> {
  const { client, database, logger } = dependencies
  if (!(await findConnectedGitHubRepository(database, job.githubRepositoryId))) {
    return { dist: "ignored", screenshots: "absent" }
  }
  const found = await client.getWorkflowRun(job.runId)
  if (!found || !isGitHubWorkflowBranchPush(job.githubRepositoryId, found)) {
    return { dist: "ignored", screenshots: "absent" }
  }
  const run = found
  const workflowPaths = await client.getBuildWorkflowPaths()
  if (!workflowPaths.includes(run.path.split("@")[0] ?? "")) {
    const settled = await settleDeselectedGitHubBuild(database, {
      githubRepositoryId: job.githubRepositoryId,
      run,
    })
    if (settled) {
      logger.info({ runId: run.id }, "Settled the Build from a deselected workflow")
    }
    return { dist: "ignored", screenshots: "absent" }
  }
  const prepared = await prepareGitHubWorkflowRunBuild(
    database,
    job.githubRepositoryId,
    run,
    workflowPaths,
    async (commitSha) => {
      const author = await client.getCommitAuthor(commitSha)
      if (!author) {
        logger.warn({ runId: run.id, commitSha }, "GitHub commit has no linked author")
      }
      return author
    },
  )
  if (prepared.status !== "ready") return { dist: "ignored", screenshots: "absent" }
  const { buildId, buildRun, distDigest, ownsBuild, state, authorError } = prepared
  if (prepared.authorPreserved) {
    logger.warn({ buildId, runId: run.id }, "Existing Build author metadata was preserved")
  }
  if (prepared.authorError) {
    logger.warn(
      {
        buildId,
        runId: run.id,
        errorType: prepared.authorError.name,
        ...(prepared.authorError instanceof GitHubCommitLookupError
          ? { statusCode: prepared.authorError.statusCode }
          : {}),
      },
      "GitHub commit author lookup failed; artifact import will continue and retry",
    )
  }
  const completed = run.status === "completed"
  const completedAt = completed ? run.updatedAt : null

  async function fail(failureSummary: string) {
    await completeGitHubBuildFailure(database, {
      buildId,
      run: buildRun,
      completedAt: authorError ? null : completedAt,
      failureSummary,
    })
    logger.warn({ buildId, runId: run.id, failureSummary }, "GitHub Build import failed")
    return "failed" as const
  }

  const downloads = new Map<number, ReturnType<typeof client.downloadArtifact>>()
  function download(artifact: GitHubWorkflowArtifact) {
    let pending = downloads.get(artifact.id)
    if (!pending) {
      pending = client.downloadArtifact(artifact.id, maximumArtifactDownloadBytes)
      downloads.set(artifact.id, pending)
    }
    return pending
  }

  async function screenshotArtifacts() {
    return byAttempt(await client.listRunArtifacts(run.id, screenshotArtifactName), run)
  }

  /** This attempt's screenshots name the dist its screenshots job downloaded. */
  async function currentScreenshotDistDigest() {
    const artifact = (await screenshotArtifacts()).current
    if (!artifact) return null
    const downloaded = await download(artifact)
    if (downloaded.status !== "ok") return null
    try {
      return extractScreenshotPackage(downloaded.bytes).distDigest
    } catch (error) {
      if (error instanceof BuildPackageError) return null
      throw error
    }
  }

  async function missingDist(reason: string) {
    if (!completed) {
      if (run.status === "in_progress") {
        await markGitHubBuildRunning(database, buildId, buildRun)
      }
      return "pending" as const
    }
    return fail(
      run.conclusion === "success"
        ? reason
        : `The GitHub Actions workflow run ended with ${run.conclusion ?? "no conclusion"}.`,
    )
  }

  async function importDist(): Promise<ImportGitHubWorkflowRunResult["dist"]> {
    if (!ownsBuild || state === "successful") return "unchanged"
    const dists = byAttempt(await client.listRunArtifacts(run.id, distArtifactName), run)
    let artifact = dists.current
    let expectedDistDigest: string | undefined
    if (!artifact && dists.earlier) {
      // A failed-jobs rerun keeps an earlier attempt's dist, but a full rerun may still be
      // building a different one. Reuse it only when this attempt vouches for its digest.
      expectedDistDigest = distDigest ?? (await currentScreenshotDistDigest()) ?? undefined
      if (expectedDistDigest) artifact = dists.earlier
    }
    if (!artifact) {
      return missingDist(`GitHub Actions did not provide the ${distArtifactName} artifact.`)
    }
    const downloaded = await download(artifact)
    if (downloaded.status === "gone") {
      return fail(`The ${distArtifactName} artifact expired before Hub imported it.`)
    }
    if (downloaded.status === "too-large") {
      return fail(`The ${distArtifactName} artifact is larger than Hub accepts.`)
    }
    const result = await importGitHubDistPackage(
      dependencies,
      {
        buildId,
        run: buildRun,
        completedAt: authorError ? null : completedAt,
        expectedDistDigest,
      },
      downloaded.bytes,
    )
    if (result.status === "digest-mismatch") {
      return missingDist(
        `The earlier ${distArtifactName} artifact does not match this attempt's screenshots.`,
      )
    }
    return result.status
  }

  async function importScreenshots(): Promise<ImportGitHubWorkflowRunResult["screenshots"]> {
    const artifacts = await screenshotArtifacts()
    const artifact = artifacts.current ?? artifacts.earlier
    if (!artifact) return "absent"
    const downloaded = await download(artifact)
    if (downloaded.status !== "ok") return "invalid"
    return (await importGitHubScreenshotPackage(dependencies, buildId, downloaded.bytes)).status
  }

  const dist = await importDist()
  if (dist === "imported" || dist === "unchanged") {
    await registerImportedPrototype(database, buildId)
  }
  const screenshots = await importScreenshots()
  if (prepared.authorError) throw prepared.authorError
  // Author and screenshot errors throw before this, so recovery retries the pass.
  if (completedAt) {
    await recordGitHubBuildRunCompletion(database, { buildId, run: buildRun, completedAt })
  }
  return { dist, screenshots }
}
