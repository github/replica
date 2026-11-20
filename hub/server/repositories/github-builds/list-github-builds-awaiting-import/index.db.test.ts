import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import type { Prisma } from "../../../generated/prisma/client"
import { prisma } from "../../../integrations/prisma"
import { githubDeselectedWorkflowFailure } from "../../../utils/github-deselected-workflow-failure"
import { listGitHubBuildsAwaitingImport } from "."

const createdAfter = new Date(Date.now() - 60 * 60 * 1_000)

async function createRepository(data: { removedAt?: Date } = {}) {
  const githubRepositoryId = randomInt(1, 2 ** 31)
  const repository = await prisma.repository.create({
    data: {
      githubRepositoryId,
      nameWithOwner: `octo/${randomUUID()}`,
      defaultBranch: "main",
      ...data,
    },
  })
  let number = 0
  return {
    githubRepositoryId,
    async createBuild(build: Omit<Prisma.BuildUncheckedCreateInput, "prototypeId" | "number">) {
      const prototype = await prisma.prototype.create({
        data: { repositoryId: repository.id, branchName: `prototype/${randomUUID()}` },
      })
      number += 1
      const runId = randomInt(1, 2 ** 31)
      await prisma.build.create({
        data: {
          prototypeId: prototype.id,
          number,
          githubWorkflowRunId: runId,
          githubWorkflowRunAttempt: 1,
          ...build,
        },
      })
      return { githubRepositoryId, runId }
    },
  }
}

describe("listGitHubBuildsAwaitingImport", () => {
  it("lists recent Builds whose dist or completed-run pass is still owed", async () => {
    const repository = await createRepository()
    const queued = await repository.createBuild({ state: "queued" })
    const running = await repository.createBuild({ state: "running" })
    const awaitingScreenshots = await repository.createBuild({ state: "successful" })
    const finished = await repository.createBuild({
      state: "successful",
      workflowCompletedAt: new Date(),
    })
    const failed = await repository.createBuild({
      state: "failed",
      workflowCompletedAt: new Date(),
    })
    const old = await repository.createBuild({
      state: "queued",
      createdAt: new Date(createdAfter.getTime() - 1),
    })
    const local = await repository.createBuild({ state: "queued", githubWorkflowRunId: null })

    const listed = await listGitHubBuildsAwaitingImport(prisma, { createdAfter, limit: 10_000 })

    expect(listed).toEqual(expect.arrayContaining([queued, running, awaitingScreenshots]))
    for (const excluded of [finished, failed, old, local])
      expect(listed).not.toContainEqual(excluded)
  })

  it("skips Builds whose repository was removed", async () => {
    const repository = await createRepository({ removedAt: new Date() })
    const build = await repository.createBuild({ state: "queued" })

    const listed = await listGitHubBuildsAwaitingImport(prisma, { createdAfter, limit: 10_000 })

    expect(listed).not.toContainEqual(build)
  })

  it("retries failed Builds only while their author lookup is pending", async () => {
    const repository = await createRepository()
    const authorPending = await repository.createBuild({
      state: "failed",
      failureSummary: "The package is invalid.",
    })
    const completed = await repository.createBuild({
      state: "failed",
      failureSummary: "The package is invalid.",
      workflowCompletedAt: new Date(),
    })
    const deselected = await repository.createBuild({
      state: "failed",
      failureSummary: githubDeselectedWorkflowFailure,
    })
    const attributed = await repository.createBuild({
      state: "failed",
      failureSummary: "The package is invalid.",
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: "9",
    })

    const listed = await listGitHubBuildsAwaitingImport(prisma, { createdAfter, limit: 10_000 })

    expect(listed).toContainEqual(authorPending)
    for (const settled of [completed, deselected, attributed]) {
      expect(listed).not.toContainEqual(settled)
    }
  })
})
