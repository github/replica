import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { settleDeselectedGitHubBuild } from "."

async function createFinishedBuild(githubWorkflowRunAttempt: number) {
  const githubRepositoryId = randomInt(1, 2 ** 31)
  const repository = await prisma.repository.create({
    data: { githubRepositoryId, nameWithOwner: `octo/${randomUUID()}`, defaultBranch: "main" },
  })
  const prototype = await prisma.prototype.create({
    data: { repositoryId: repository.id, branchName: "proto/welcome" },
  })
  const build = await prisma.build.create({
    data: {
      prototypeId: prototype.id,
      number: 1,
      state: "failed",
      failureSummary: "The package is invalid.",
      commitSha: "a".repeat(40),
      githubWorkflowRunId: 100n,
      githubWorkflowRunAttempt,
    },
  })
  const run = {
    id: 100,
    runAttempt: 1,
    headBranch: "proto/welcome",
    headSha: "a".repeat(40),
    status: "completed",
    updatedAt: new Date("2026-01-01T00:05:00Z"),
  }
  return { build, run, githubRepositoryId }
}

describe("settleDeselectedGitHubBuild()", () => {
  it("records only the completion of a finished Build from the completed run", async () => {
    const { build, run, githubRepositoryId } = await createFinishedBuild(1)

    await expect(settleDeselectedGitHubBuild(prisma, { githubRepositoryId, run })).resolves.toBe(
      true,
    )

    const settled = await prisma.build.findUniqueOrThrow({ where: { id: build.id } })
    expect(settled).toEqual({
      ...build,
      updatedAt: settled.updatedAt,
      workflowCompletedAt: run.updatedAt,
    })
  })

  it("leaves a finished Build alone for an in-progress run or an older attempt", async () => {
    const inProgress = await createFinishedBuild(1)
    const newer = await createFinishedBuild(2)

    for (const { run, githubRepositoryId } of [
      { ...inProgress, run: { ...inProgress.run, status: "in_progress" } },
      newer,
    ]) {
      await expect(settleDeselectedGitHubBuild(prisma, { githubRepositoryId, run })).resolves.toBe(
        false,
      )
    }

    for (const { build } of [inProgress, newer]) {
      expect(await prisma.build.findUniqueOrThrow({ where: { id: build.id } })).toEqual(build)
    }
  })
})
