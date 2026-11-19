import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import type { BuildState } from "../../../generated/prisma/client.ts"
import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types.ts"
import { prisma } from "../../../integrations/prisma/index.ts"
import { discoverGitHubWorkflowRuns } from "./index.ts"

const createdAfter = new Date(Date.now() - 60 * 60 * 1_000)

function workflowRun(githubRepositoryId: number, fields: Partial<GitHubWorkflowRun> = {}) {
  return {
    id: randomInt(1, 2 ** 31),
    runAttempt: 1,
    path: ".github/workflows/replica.yml",
    event: "push",
    headBranch: "prototype/a",
    headSha: "a".repeat(40),
    status: "completed",
    conclusion: "success",
    htmlUrl: "https://github.com/o/r/actions/runs/1",
    createdAt: new Date(),
    updatedAt: new Date(),
    repositoryId: githubRepositoryId,
    actor: null,
    ...fields,
  } satisfies GitHubWorkflowRun
}

async function createRepository() {
  const githubRepositoryId = randomInt(1, 2 ** 31)
  const repository = await prisma.repository.create({
    data: { githubRepositoryId, nameWithOwner: `octo/${randomUUID()}`, defaultBranch: "main" },
  })
  let number = 0
  return {
    githubRepositoryId,
    async saveBuild(
      run: GitHubWorkflowRun,
      state: BuildState,
      { attempt = run.runAttempt, completed = false } = {},
    ) {
      const prototype = await prisma.prototype.create({
        data: { repositoryId: repository.id, branchName: `prototype/${randomUUID()}` },
      })
      number += 1
      await prisma.build.create({
        data: {
          prototypeId: prototype.id,
          number,
          state,
          githubWorkflowRunId: run.id,
          githubWorkflowRunAttempt: attempt,
          workflowCompletedAt: completed ? new Date() : null,
        },
      })
    },
  }
}

describe("discoverGitHubWorkflowRuns", () => {
  it("queues runs whose Build is missing or can still change", async () => {
    const repository = await createRepository()
    const id = repository.githubRepositoryId
    const unseen = workflowRun(id, { status: "in_progress", conclusion: null })
    const queued = workflowRun(id)
    const awaitingScreenshots = workflowRun(id)
    const finished = workflowRun(id)
    const superseded = workflowRun(id)
    const failed = workflowRun(id)
    const rerunAfterFailure = workflowRun(id, { runAttempt: 2 })
    const installer = workflowRun(id, { headBranch: "replica/install-workflow" })
    await repository.saveBuild(queued, "queued")
    await repository.saveBuild(awaitingScreenshots, "successful")
    await repository.saveBuild(finished, "successful", { completed: true })
    await repository.saveBuild(superseded, "superseded")
    await repository.saveBuild(failed, "failed", { completed: true })
    await repository.saveBuild(rerunAfterFailure, "failed", { attempt: 1, completed: true })
    const runs = [
      unseen,
      queued,
      awaitingScreenshots,
      finished,
      superseded,
      failed,
      rerunAfterFailure,
      installer,
    ]
    const listWorkflowRuns = vi.fn((githubRepositoryId: number) =>
      Promise.resolve(githubRepositoryId === id ? runs : []),
    )

    const jobs = await discoverGitHubWorkflowRuns(
      { database: prisma, listWorkflowRuns, logger: { warn: vi.fn() } },
      { createdAfter },
    )

    expect(listWorkflowRuns).toHaveBeenCalledWith(id, createdAfter)
    const discovered = jobs.filter((job) => job.githubRepositoryId === id).map((job) => job.runId)
    expect(discovered.sort()).toEqual(
      [unseen, queued, awaitingScreenshots, rerunAfterFailure].map((run) => run.id).sort(),
    )
  })

  it("keeps discovering other repositories when one cannot be listed", async () => {
    const broken = await createRepository()
    const healthy = await createRepository()
    const run = workflowRun(healthy.githubRepositoryId)
    const warn = vi.fn()

    const jobs = await discoverGitHubWorkflowRuns(
      {
        database: prisma,
        listWorkflowRuns: (githubRepositoryId) =>
          githubRepositoryId === broken.githubRepositoryId
            ? Promise.reject(new Error("GitHub unavailable"))
            : Promise.resolve(githubRepositoryId === healthy.githubRepositoryId ? [run] : []),
        logger: { warn },
      },
      { createdAfter },
    )

    expect(jobs).toContainEqual({ githubRepositoryId: healthy.githubRepositoryId, runId: run.id })
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ githubRepositoryId: broken.githubRepositoryId }),
      "GitHub workflow run discovery failed",
    )
  })
})
