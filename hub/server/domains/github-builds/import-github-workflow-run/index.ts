import { completeGitHubBuildFailure } from "../../../repositories/github-builds/complete-github-build-failure/index.ts"
import { completeGitHubBuildSuccess } from "../../../repositories/github-builds/complete-github-build-success/index.ts"
import { attachGitHubBuildScreenshots } from "../../../repositories/github-builds/attach-github-build-screenshots/index.ts"
import { markGitHubBuildRunning } from "../../../repositories/github-builds/mark-github-build-running/index.ts"
import { prepareGitHubBuild } from "../../../repositories/github-builds/prepare-github-build/index.ts"
import type {
  GitHubWorkflowArtifact,
  GitHubWorkflowRun,
} from "../../../integrations/github/create-github-actions-client/types.ts"
import { BuildPackageError } from "../../build-artifacts/errors.ts"
import { extractDistPackage } from "../../build-artifacts/extract-dist-package/index.ts"
import { extractScreenshotPackage } from "../../build-artifacts/extract-screenshot-package/index.ts"
import {
  distArtifactName,
  maximumArtifactDownloadBytes,
  replicaWorkflowPath,
  screenshotArtifactName,
} from "../constants.ts"
import type { GitHubWorkflowRunJob } from "../get-github-workflow-run-job-definition/index.ts"
import { storeGitHubBuildFiles } from "../store-github-build-files/index.ts"
import type { ImportGitHubWorkflowRunDependencies, ImportGitHubWorkflowRunResult } from "./types.ts"

function isReplicaRun(run: GitHubWorkflowRun, githubRepositoryId: number) {
  return (
    run.repositoryId === githubRepositoryId &&
    run.path.split("@")[0] === replicaWorkflowPath &&
    run.event === "push" &&
    run.headBranch !== null &&
    run.headBranch !== "replica/install-workflow" &&
    /^[0-9a-f]{40}$/.test(run.headSha) &&
    run.htmlUrl.startsWith("https://")
  )
}

function newest(artifacts: GitHubWorkflowArtifact[]) {
  return artifacts.filter((artifact) => !artifact.expired).sort((a, b) => b.id - a.id)[0]
}

/**
 * Imports one workflow run. The dist package is imported as soon as its job
 * uploads it; screenshots attach later only to the Build whose dist they depict,
 * so a slow or failed screenshot job never delays, fails, or changes the Build.
 * Transient errors throw so the job retries; invalid packages fail the Build.
 */
export async function importGitHubWorkflowRun(
  dependencies: ImportGitHubWorkflowRunDependencies,
  job: GitHubWorkflowRunJob,
): Promise<ImportGitHubWorkflowRunResult> {
  const { client, database, logger, storage } = dependencies
  const found = await client.getWorkflowRun(job.runId)
  if (!found || !isReplicaRun(found, job.githubRepositoryId) || !found.headBranch) {
    return { dist: "ignored", screenshots: "absent" }
  }
  const run = found
  const branchName = found.headBranch
  const buildRun = {
    runId: BigInt(run.id),
    runAttempt: run.runAttempt,
    workflowUrl: run.htmlUrl,
    createdAt: run.createdAt,
  }
  const prepared = await prepareGitHubBuild(database, {
    githubRepositoryId: job.githubRepositoryId,
    branchName,
    commitSha: run.headSha,
    run: buildRun,
    author: run.actor
      ? {
          providerUserId: String(run.actor.id),
          login: run.actor.login,
          avatarUrl: run.actor.avatarUrl,
        }
      : null,
  })
  if (prepared.status !== "ready") return { dist: "ignored", screenshots: "absent" }
  const { buildId, ownsBuild, state } = prepared
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
    const artifact = newest(await client.listRunArtifacts(run.id, distArtifactName))
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
    let extracted
    try {
      extracted = extractDistPackage(download.bytes)
    } catch (error) {
      if (error instanceof BuildPackageError) return fail(error.message)
      throw error
    }
    const artifacts = await storeGitHubBuildFiles(storage, buildId, extracted.files)
    const imported = await completeGitHubBuildSuccess(database, {
      buildId,
      run: buildRun,
      completedAt: run.updatedAt,
      distDigest: extracted.distDigest,
      artifacts,
    })
    if (imported) logger.info({ buildId, runId: run.id }, "GitHub Build imported")
    return imported ? "imported" : "unchanged"
  }

  async function importScreenshots(): Promise<ImportGitHubWorkflowRunResult["screenshots"]> {
    const artifact = newest(await client.listRunArtifacts(run.id, screenshotArtifactName))
    if (!artifact) return "absent"
    const download = await client.downloadArtifact(artifact.id, maximumArtifactDownloadBytes)
    if (download.status !== "ok") return "invalid"
    let extracted
    try {
      extracted = extractScreenshotPackage(download.bytes)
    } catch (error) {
      if (error instanceof BuildPackageError) {
        logger.warn({ buildId, runId: run.id, reason: error.message }, "Screenshots rejected")
        return "invalid"
      }
      throw error
    }
    const artifacts = await storeGitHubBuildFiles(storage, buildId, extracted.files)
    return attachGitHubBuildScreenshots(database, {
      buildId,
      distDigest: extracted.distDigest,
      artifacts,
    })
  }

  const dist = await importDist()
  return { dist, screenshots: await importScreenshots() }
}
