import { z } from "zod"

import {
  InvalidGitHubInstallationEvidence,
  type GitHubInstallationClient,
} from "../create-installation-client/index.ts"
import { GitHubProviderRequestError } from "../errors.ts"
import {
  githubBranchName,
  githubCommitSha,
  githubId,
  githubRepositoryPath,
  installationBranch,
  replicaWorkflowPath,
} from "../hosted-build-evidence.ts"
import type { GitHubRepositoryEvidence } from "../types.ts"

const runHeader = z.object({ path: z.string(), event: z.string() })
const repositoryIdentity = z.object({ id: githubId })
const runSchema = z.object({
  id: githubId,
  repository: repositoryIdentity,
  head_repository: repositoryIdentity.nullable(),
  head_branch: githubBranchName,
  head_sha: githubCommitSha,
  run_attempt: z.number().int().positive().max(2_147_483_647),
  status: z.enum(["pending", "queued", "requested", "waiting", "in_progress", "completed"]),
  conclusion: z
    .enum([
      "success",
      "action_required",
      "cancelled",
      "failure",
      "neutral",
      "skipped",
      "stale",
      "startup_failure",
      "timed_out",
    ])
    .nullable(),
  created_at: z.iso.datetime({ offset: true }),
})
const recentRuns = z.object({ workflow_runs: z.array(z.unknown()).max(100) })
const attemptTimes = z.object({
  run_started_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
})

export interface GitHubWorkflowRun {
  id: bigint
  attempt: number
  branchName: string
  commitSha: string
  createdAt: Date
  state: "queued" | "running" | "completed"
  conclusion: z.infer<typeof runSchema>["conclusion"]
}

function eligibleRun(repositoryId: number, data: unknown): GitHubWorkflowRun | null {
  const header = runHeader.parse(data)
  if (header.path !== replicaWorkflowPath || header.event !== "push") return null
  const run = runSchema.parse(data)
  if (run.repository.id !== repositoryId) throw new GitHubProviderRequestError()
  if (run.head_repository?.id !== repositoryId || run.head_branch === installationBranch)
    return null
  if ((run.status === "completed") !== (run.conclusion !== null))
    throw new GitHubProviderRequestError()
  return {
    id: BigInt(run.id),
    attempt: run.run_attempt,
    branchName: run.head_branch,
    commitSha: run.head_sha,
    createdAt: new Date(run.created_at),
    state:
      run.status === "in_progress"
        ? "running"
        : run.status === "completed"
          ? "completed"
          : "queued",
    conclusion: run.conclusion,
  }
}

export async function readHostedWorkflowRuns(
  client: GitHubInstallationClient,
  repository: GitHubRepositoryEvidence,
) {
  const { workflow_runs: runs } = await client.get(
    `${githubRepositoryPath(repository.nameWithOwner)}/actions/workflows/replica.yml/runs?event=push&per_page=100`,
    recentRuns,
  )
  const result = runs.flatMap((data) => eligibleRun(repository.githubRepositoryId, data) ?? [])
  if (new Set(result.map(({ id }) => id)).size !== result.length)
    throw new GitHubProviderRequestError()
  return result
}

export async function readSavedWorkflowRun(
  client: GitHubInstallationClient,
  repository: GitHubRepositoryEvidence,
  runId: bigint,
) {
  const data = await client.get(
    `${githubRepositoryPath(repository.nameWithOwner)}/actions/runs/${runId}`,
    z.unknown(),
  )
  const run = eligibleRun(repository.githubRepositoryId, data)
  if (!run || run.id !== runId) throw new GitHubProviderRequestError()
  return run
}

export async function readSuccessfulWorkflowAttempt(
  client: GitHubInstallationClient,
  repository: GitHubRepositoryEvidence,
  expected: { id: bigint; attempt: number; branchName: string; commitSha: string },
) {
  const data = await client.get(
    `${githubRepositoryPath(repository.nameWithOwner)}/actions/runs/${expected.id}/attempts/${expected.attempt}`,
    z.unknown(),
  )
  try {
    const run = eligibleRun(repository.githubRepositoryId, data)
    const { run_started_at, updated_at } = attemptTimes.parse(data)
    const startedAt = new Date(run_started_at)
    const finishedAt = new Date(updated_at)
    if (
      !run ||
      run.id !== expected.id ||
      run.attempt !== expected.attempt ||
      run.branchName !== expected.branchName ||
      run.commitSha !== expected.commitSha ||
      run.conclusion !== "success" ||
      startedAt < run.createdAt ||
      finishedAt <= startedAt
    ) {
      throw new InvalidGitHubInstallationEvidence()
    }
    return { startedAt, finishedAt }
  } catch (error) {
    throw new InvalidGitHubInstallationEvidence({ cause: error })
  }
}
