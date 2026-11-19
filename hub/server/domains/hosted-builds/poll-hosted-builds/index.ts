import type { Logger } from "pino"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import {
  createGitHubInstallationClient,
  GitHubInstallationHttpError,
  type GitHubInstallationClient,
} from "../../../integrations/github/create-installation-client/index.ts"
import type {
  GitHubInstallationCredentials,
  GitHubInstallationTransport,
} from "../../../integrations/github/create-installation-client/types.ts"
import { installationBranch } from "../../../integrations/github/hosted-build-evidence.ts"
import { readInstallationRepositories } from "../../../integrations/github/list-installation-repositories/index.ts"
import { readHostedBranchHeads } from "../../../integrations/github/read-hosted-branch-heads/index.ts"
import {
  readHostedWorkflowRuns,
  readSavedWorkflowRun,
  type GitHubWorkflowRun,
} from "../../../integrations/github/read-hosted-workflow-runs/index.ts"
import type { GitHubRepositoryEvidence } from "../../../integrations/github/types.ts"
import { readGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/read-github-repository-access-state/index.ts"
import { readHostedBranchOwners } from "../../../repositories/hosted-builds/read-hosted-branch-owners/index.ts"
import { readHostedBuildRepository } from "../../../repositories/hosted-builds/read-hosted-build-repository/index.ts"
import {
  failMissingHostedRun,
  readPendingHostedImports,
  readSavedUnfinishedRuns,
} from "../../../repositories/hosted-builds/read-hosted-work/index.ts"
import {
  recordHostedBranchHeads,
  recordHostedWorkflowRun,
} from "../../../repositories/hosted-builds/record-hosted-build-evidence/index.ts"
import { syncGitHubInstallationRepositories } from "../../admission/sync-github-installation-repositories/index.ts"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"
import { importHostedBuild } from "../import-hosted-build/index.ts"
import {
  withHostedBuildRepository,
  type HostedBuildAuthority,
} from "../with-hosted-build-repository/index.ts"

interface PollHostedBuildsInput {
  database: PrismaClient
  storage: ArtifactStorage
  credentials: GitHubInstallationCredentials
  provider: HostedBuildAuthority["provider"]
  transport?: GitHubInstallationTransport
  logger: Pick<Logger, "warn">
}

interface PollSummary {
  repositories: number
  branches: number
  successful: number
  failed: number
  retryable: number
  discoveryFailures: number
}

function notFound(error: unknown) {
  return error instanceof GitHubInstallationHttpError && error.status === 404 && !error.limited
}

function reportFailure(
  logger: PollHostedBuildsInput["logger"],
  summary: PollSummary,
  repositoryId: string,
  error: unknown,
) {
  summary.discoveryFailures += 1
  logger.warn(
    { repositoryId, errorType: error instanceof Error ? error.name : "UnknownError" },
    "Hosted Build discovery could not finish",
  )
}

async function pollRepository(
  authority: HostedBuildAuthority,
  repository: GitHubRepositoryEvidence,
  branchScan: number,
  client: GitHubInstallationClient,
  { storage, logger }: PollHostedBuildsInput,
  summary: PollSummary,
) {
  const {
    database,
    repository: { id: repositoryId },
  } = authority
  const owners = await readHostedBranchOwners(database, repositoryId)
  const { heads, retiredToResume } = await readHostedBranchHeads(client, repository, owners)
  const accepted = await withHostedBuildRepository(
    { ...authority, repository: { ...authority.repository, branchScan } },
    async (transaction) => {
      await recordHostedBranchHeads(transaction, {
        repositoryId,
        defaultBranch: repository.defaultBranch,
        installationBranch,
        owners,
        heads,
        retiredToResume,
      })
      return true
    },
  )
  if (!accepted) return
  summary.branches += heads.size

  async function record(run: GitHubWorkflowRun) {
    const outcome = await withHostedBuildRepository(authority, (transaction) =>
      recordHostedWorkflowRun(transaction, repositoryId, run),
    )
    if (outcome === "ambiguous")
      throw new Error("The workflow creation time overlaps branch retirement.")
    return outcome === "recorded"
  }

  const observed: bigint[] = []
  let runs: GitHubWorkflowRun[] = []
  try {
    runs = await readHostedWorkflowRuns(client, repository)
  } catch (error) {
    // A connected repository need not have installed the approved workflow yet.
    if (!notFound(error)) reportFailure(logger, summary, repositoryId, error)
  }
  for (const run of runs) {
    try {
      if (await record(run)) observed.push(run.id)
    } catch (error) {
      reportFailure(logger, summary, repositoryId, error)
    }
  }
  for (const build of await readSavedUnfinishedRuns(database, repositoryId, observed)) {
    if (build.githubWorkflowRunId === null) continue
    try {
      await record(await readSavedWorkflowRun(client, repository, build.githubWorkflowRunId))
    } catch (error) {
      if (notFound(error)) {
        await withHostedBuildRepository(authority, (transaction) =>
          failMissingHostedRun(transaction, build),
        )
      } else {
        reportFailure(logger, summary, repositoryId, error)
      }
    }
  }
  for (const build of await readPendingHostedImports(database, repositoryId)) {
    if (!build.commitSha || build.githubWorkflowRunId === null || !build.githubWorkflowRunAttempt)
      continue
    try {
      const outcome = await importHostedBuild(authority, client, storage, repository, {
        id: build.id,
        prototypeId: build.prototypeId,
        branchName: build.prototype.branchName,
        commitSha: build.commitSha,
        runId: build.githubWorkflowRunId,
        runAttempt: build.githubWorkflowRunAttempt,
        artifactId: build.githubArtifactId,
      })
      if (outcome !== "skipped") summary[outcome] += 1
    } catch (error) {
      reportFailure(logger, summary, repositoryId, error)
    }
  }
}

/** Performs one bounded, installation-scoped discovery and import cycle. */
export async function pollHostedBuilds(input: PollHostedBuildsInput): Promise<PollSummary> {
  const { credentials, database, logger, provider, transport } = input
  const client = await createGitHubInstallationClient(credentials, transport)
  const installed = await syncGitHubInstallationRepositories(
    database,
    () => readInstallationRepositories(client),
    provider,
  )
  const { revision: accessRevision } = await readGitHubRepositoryAccessState(database)
  const summary: PollSummary = {
    repositories: installed.length,
    branches: 0,
    successful: 0,
    failed: 0,
    retryable: 0,
    discoveryFailures: 0,
  }
  for (const repository of installed) {
    const githubId = BigInt(repository.githubRepositoryId)
    const stored = await readHostedBuildRepository(database, githubId)
    if (
      stored?.nameWithOwner !== repository.nameWithOwner ||
      stored.defaultBranch !== repository.defaultBranch
    )
      continue
    try {
      await pollRepository(
        {
          database,
          provider,
          repository: {
            id: stored.id,
            githubId,
            accessRevision,
            nameWithOwner: stored.nameWithOwner,
            defaultBranch: stored.defaultBranch,
          },
        },
        repository,
        stored.hostedBranchScan,
        client,
        input,
        summary,
      )
    } catch (error) {
      reportFailure(logger, summary, stored.id, error)
    }
  }
  return summary
}
