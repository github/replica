import type { GitHubActionsRunIdentity } from "../../../integrations/github/verify-github-actions-token/types.ts"
import { markGitHubBuildRunning } from "../../../repositories/github-builds/mark-github-build-running/index.ts"
import { importGitHubDistPackage } from "../import-github-dist-package/index.ts"
import { prepareGitHubWorkflowRunBuild } from "../prepare-github-workflow-run-build/index.ts"
import type { ReceiveGitHubBuildPushDependencies, ReceiveGitHubBuildPushResult } from "./types.ts"

/**
 * Imports a dist package pushed by a verified workflow run. GitHub's record of the run
 * orders Builds, so pushed and webhook imports agree. Successful Builds never change.
 */
export async function receiveGitHubBuildPush(
  dependencies: ReceiveGitHubBuildPushDependencies,
  identity: GitHubActionsRunIdentity,
  bytes: Buffer,
): Promise<ReceiveGitHubBuildPushResult> {
  const run = await dependencies.client.getWorkflowRun(identity.runId)
  if (!run) return { status: "unavailable" }
  if (
    run.headSha !== identity.commitSha ||
    run.headBranch !== identity.branchName ||
    run.runAttempt !== identity.runAttempt
  ) {
    return { status: "rejected", reason: "The workflow run does not match its token." }
  }
  const prepared = await prepareGitHubWorkflowRunBuild(
    dependencies.database,
    identity.githubRepositoryId,
    run,
  )
  if (prepared.status === "unknown-repository") return prepared
  if (prepared.status !== "ready") {
    return { status: "rejected", reason: "The workflow run cannot publish Builds." }
  }
  const { buildId, buildRun, ownsBuild, state } = prepared
  if (!ownsBuild) {
    if (state === "successful") return { status: "unchanged", buildId }
    if (state === "failed") {
      return {
        status: "rejected",
        reason:
          "This Build already failed for this run attempt. Re-run the workflow to publish again.",
      }
    }
    return { status: "rejected", reason: "A newer workflow run owns this Build." }
  }
  await markGitHubBuildRunning(dependencies.database, buildId, buildRun)
  const result = await importGitHubDistPackage(
    dependencies,
    { buildId, run: buildRun, completedAt: run.status === "completed" ? run.updatedAt : null },
    bytes,
  )
  if (result.status === "failed") return { ...result, buildId }
  return { status: result.status, buildId }
}
