import { completeGitHubBuildFailure } from "../../../repositories/github-builds/complete-github-build-failure/index.ts"
import { markGitHubBuildRunning } from "../../../repositories/github-builds/mark-github-build-running/index.ts"
import { recordGitHubBuildRunCompletion } from "../../../repositories/github-builds/record-github-build-run-completion/index.ts"
import { registerImportedPrototype } from "../../prototypes/register-imported-prototype/index.ts"
import type {
  GitHubWorkflowArtifact,
  GitHubWorkflowRun,
} from "../../../integrations/github/create-github-actions-client/types.ts"
import {
  distArtifactName,
  maximumArtifactDownloadBytes,
  screenshotArtifactName,
} from "../constants.ts"
import type { GitHubWorkflowRunJob } from "../get-github-workflow-run-job-definition/index.ts"
import { importGitHubDistPackage } from "../import-github-dist-package/index.ts"
import { importGitHubScreenshotPackage } from "../import-github-screenshot-package/index.ts"
import { prepareGitHubWorkflowRunBuild } from "../prepare-github-workflow-run-build/index.ts"
import type { ImportGitHubWorkflowRunDependencies, ImportGitHubWorkflowRunResult } from "./types.ts"

function newest(artifacts: GitHubWorkflowArtifact[], run: GitHubWorkflowRun) {
  const retained = artifacts.filter((artifact) => !artifact.expired).sort((a, b) => b.id - a.id)
  // Prefer this attempt, but failed-jobs reruns may retain an earlier job's artifact.
  return (
    retained.find(
      (artifact) => run.startedAt && artifact.createdAt && artifact.createdAt >= run.startedAt,
    ) ?? retained[0]
  )
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
  const found = await client.getWorkflowRun(job.runId)
  if (!found) return { dist: "ignored", screenshots: "absent" }
  const run = found
  const prepared = await prepareGitHubWorkflowRunBuild(database, job.githubRepositoryId, run)
  if (prepared.status !== "ready") return { dist: "ignored", screenshots: "absent" }
  const { buildId, buildRun, ownsBuild, state } = prepared
  const completed = run.status === "completed"
  const completedAt = completed ? run.updatedAt : null

  async function fail(failureSummary: string) {
    await completeGitHubBuildFailure(database, {
      buildId,
      run: buildRun,
      completedAt,
      failureSummary,
    })
    logger.warn({ buildId, runId: run.id, failureSummary }, "GitHub Build import failed")
    return "failed" as const
  }

  async function importDist(): Promise<ImportGitHubWorkflowRunResult["dist"]> {
    if (!ownsBuild || state === "successful") return "unchanged"
    const artifact = newest(await client.listRunArtifacts(run.id, distArtifactName), run)
    if (!artifact) {
      if (!completed) {
        await markGitHubBuildRunning(database, buildId, buildRun)
        return "pending"
      }
      return fail(
        run.conclusion === "success"
          ? `GitHub Actions did not provide the ${distArtifactName} artifact.`
          : `The GitHub Actions workflow run ended with ${run.conclusion ?? "no conclusion"}.`,
      )
    }
    const download = await client.downloadArtifact(artifact.id, maximumArtifactDownloadBytes)
    if (download.status === "gone") {
      return fail(`The ${distArtifactName} artifact expired before Hub imported it.`)
    }
    if (download.status === "too-large") {
      return fail(`The ${distArtifactName} artifact is larger than Hub accepts.`)
    }
    const result = await importGitHubDistPackage(
      dependencies,
      { buildId, run: buildRun, completedAt },
      download.bytes,
    )
    return result.status
  }

  async function importScreenshots(): Promise<ImportGitHubWorkflowRunResult["screenshots"]> {
    const artifact = newest(await client.listRunArtifacts(run.id, screenshotArtifactName), run)
    if (!artifact) return "absent"
    const download = await client.downloadArtifact(artifact.id, maximumArtifactDownloadBytes)
    if (download.status !== "ok") return "invalid"
    return (await importGitHubScreenshotPackage(dependencies, buildId, download.bytes)).status
  }

  const dist = await importDist()
  if (dist === "imported" || dist === "unchanged") {
    await registerImportedPrototype(database, buildId)
  }
  const screenshots = await importScreenshots()
  // Screenshot errors throw before this, so recovery keeps retrying until they attach.
  if (completedAt) {
    await recordGitHubBuildRunCompletion(database, { buildId, run: buildRun, completedAt })
  }
  return { dist, screenshots }
}
