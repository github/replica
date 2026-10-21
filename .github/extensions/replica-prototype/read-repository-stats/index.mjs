import { access } from "node:fs/promises"
import path from "node:path"

import { readRepositoryName } from "../read-repository-name/index.mjs"
import { runCommand } from "../run-command/index.mjs"
import { readRemoteBranch } from "../read-remote-branch/index.mjs"
import { readWorkingTreeChanges } from "../working-tree-changes/index.mjs"

const WORKFLOW_PATH = ".github/workflows/replica.yml"

export async function readRepositoryStats(context) {
  const [branchResult, commitResult, statusResult, workflowExists, repositoryResult] =
    await Promise.all([
      runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], context.repositoryPath),
      runCommand("git", ["rev-parse", "HEAD"], context.repositoryPath),
      readWorkingTreeChanges(context.repositoryPath),
      fileExists(path.join(context.repositoryPath, WORKFLOW_PATH)),
      readRepositoryName(context.repositoryPath),
    ])

  const branchName = branchResult.ok ? branchResult.stdout.trim() : null
  const detached = branchName === "HEAD"
  const localBranch = detached ? null : branchName
  const branch = localBranch
  const branchError = localBranch
    ? null
    : detached
      ? "The current Git checkout has a detached HEAD."
      : branchResult.error || "The current Git branch is unavailable."
  const repository = repositoryResult.repository || context.target.repository
  const commitSha =
    commitResult.ok && /^[0-9a-f]{40}$/.test(commitResult.stdout.trim())
      ? commitResult.stdout.trim()
      : null
  const workingTree = statusResult.state
  const [comparison, workflow, remoteBranch] = await Promise.all([
    localBranch
      ? readBranchComparison(context.repositoryPath)
      : { branch: null, source: null, behind: null, error: branchError },
    readWorkflowStatus({
      repositoryPath: context.repositoryPath,
      repository: repositoryResult.repository,
      branch: localBranch,
      commitSha,
      workflowExists,
    }),
    readRemoteBranch({
      repositoryPath: context.repositoryPath,
      repository: repositoryResult.repository,
      branch: localBranch,
      commitSha,
    }),
  ])
  const [latestBranch, latestCommit, latestRepository] = await Promise.all([
    runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], context.repositoryPath),
    runCommand("git", ["rev-parse", "HEAD"], context.repositoryPath),
    readRepositoryName(context.repositoryPath),
  ])
  if (
    !latestBranch.ok ||
    !latestCommit.ok ||
    latestBranch.stdout.trim() !== branchName ||
    latestCommit.stdout.trim() !== commitSha ||
    latestRepository.repository !== repositoryResult.repository
  ) {
    remoteBranch.state = "unknown"
    remoteBranch.error = "The checkout changed during the check. Refresh publication status."
  }

  return {
    branch,
    branchError,
    comparison,
    repository,
    repositoryError: repository ? null : repositoryResult.error,
    commitSha,
    publishedUrl: context.target.publishedUrl,
    workingTree,
    workingTreeError: statusResult.error ?? null,
    replicaWorkflowExists: workflowExists,
    workflow,
    remoteBranch,
    urlHost: context.urlHost,
    refreshedAt: new Date().toISOString(),
  }
}

async function readBranchComparison(repositoryPath) {
  const upstream = await runCommand(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    repositoryPath,
  )
  let branch = upstream.ok ? upstream.stdout.trim() : ""
  let source = "upstream"
  if (!branch) {
    const main = await runCommand("git", ["branch", "--list", "main"], repositoryPath)
    if (!main.ok) return { branch: null, source: null, behind: null, error: main.error }
    if (!main.stdout.trim()) {
      return {
        branch: null,
        source: null,
        behind: null,
        error: "No upstream or local main branch is available.",
      }
    }
    branch = "main"
    source = "local"
  }

  const result = await runCommand(
    "git",
    ["rev-list", "--left-right", "--count", `${branch}...HEAD`],
    repositoryPath,
  )
  if (!result.ok) return { branch, source, behind: null, error: result.error }
  const counts = /^(\d+)\s+(\d+)\s*$/.exec(result.stdout)
  if (!counts) {
    return {
      branch,
      source,
      behind: null,
      error: "Git returned an invalid branch comparison.",
    }
  }
  return { branch, source, behind: Number(counts[1]), error: null }
}

async function readWorkflowStatus({
  repositoryPath,
  repository,
  branch,
  commitSha,
  workflowExists,
}) {
  if (!workflowExists) {
    return {
      state: "not_published",
      detail: `${WORKFLOW_PATH} is not present.`,
      run: null,
    }
  }
  if (!branch) {
    return {
      state: "unavailable",
      detail: "The current git branch is unavailable.",
      run: null,
    }
  }
  if (!repository || !commitSha) {
    return {
      state: "unavailable",
      detail: "The GitHub origin or checkout commit could not be verified.",
      run: null,
    }
  }

  const result = await runCommand(
    "gh",
    [
      "run",
      "list",
      "--repo",
      `github.com/${repository}`,
      "--workflow",
      WORKFLOW_PATH,
      "--branch",
      branch,
      "--commit",
      commitSha,
      "--limit",
      "100",
      "--json",
      "status,conclusion,createdAt,updatedAt,url,headSha,headBranch,databaseId",
    ],
    repositoryPath,
  )

  if (!result.ok) {
    return {
      state: "unavailable",
      detail: result.error,
      run: null,
    }
  }

  let runs
  try {
    runs = JSON.parse(result.stdout)
  } catch {
    return {
      state: "unavailable",
      detail: "GitHub CLI returned invalid workflow data.",
      run: null,
    }
  }

  if (
    !Array.isArray(runs) ||
    runs.some(
      (candidate) =>
        !candidate ||
        typeof candidate.status !== "string" ||
        typeof candidate.headSha !== "string" ||
        typeof candidate.headBranch !== "string",
    )
  ) {
    return { state: "unavailable", detail: "GitHub CLI returned invalid workflow data.", run: null }
  }
  const successfulRuns = Array.isArray(runs)
    ? runs.filter(
        (candidate) => candidate.status === "completed" && candidate.conclusion === "success",
      )
    : []
  const candidate = Array.isArray(runs)
    ? commitSha
      ? runs.find((candidate) => candidate.headSha === commitSha && candidate.headBranch === branch)
      : runs[0]
    : null
  if (!candidate) {
    return {
      state: "not_published",
      detail: commitSha
        ? `No Replica workflow run was found for ${branch} at ${commitSha.slice(0, 7)}.`
        : `No Replica workflow run was found for ${branch}.`,
      run: null,
    }
  }

  const run = {
    ...candidate,
    conclusion:
      candidate.status !== "completed" && candidate.conclusion === "" ? null : candidate.conclusion,
  }

  if (run.status !== "completed") {
    return {
      state: "in_progress",
      detail: `Replica workflow is ${formatStatus(run.status)}.`,
      run,
    }
  }
  if (run.conclusion === "success") {
    const actorResult = await readWorkflowActor({
      repositoryPath,
      repository,
      runId: run.databaseId,
    })

    return {
      state: "succeeded",
      detail: "The latest Replica workflow completed successfully.",
      run: {
        ...run,
        actor: actorResult.actor,
        actorError: actorResult.error,
      },
      lastUpdatedAt: run.updatedAt,
      versionCount: successfulRuns.length,
    }
  }

  return {
    state: "failed",
    detail: `The latest Replica workflow finished with ${formatStatus(run.conclusion || "an unknown result")}.`,
    run,
  }
}

async function readWorkflowActor({ repositoryPath, repository, runId }) {
  if (!repository || !runId) {
    return {
      actor: null,
      error: "The workflow publisher is unavailable.",
    }
  }

  const runResult = await runCommand(
    "gh",
    ["api", `repos/${repository}/actions/runs/${runId}`],
    repositoryPath,
  )
  if (!runResult.ok) {
    return {
      actor: null,
      error: runResult.error,
    }
  }

  let workflowRun
  try {
    workflowRun = JSON.parse(runResult.stdout)
  } catch {
    return {
      actor: null,
      error: "GitHub CLI returned invalid workflow actor data.",
    }
  }

  const login = workflowRun?.actor?.login
  if (typeof login !== "string" || login === "") {
    return {
      actor: null,
      error: "The workflow publisher is unavailable.",
    }
  }

  const profileResult = await runCommand(
    "gh",
    ["api", `users/${encodeURIComponent(login)}`],
    repositoryPath,
  )
  let profile = null
  if (profileResult.ok) {
    try {
      profile = JSON.parse(profileResult.stdout)
    } catch {
      profile = null
    }
  }

  return {
    actor: {
      login,
      name: typeof profile?.name === "string" && profile.name.trim() ? profile.name.trim() : null,
      avatarUrl: workflowRun.actor.avatar_url || profile?.avatar_url || null,
    },
    error: profileResult.ok ? null : profileResult.error,
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false
    }
    throw error
  }
}

function formatStatus(value) {
  return String(value).replaceAll("_", " ")
}
