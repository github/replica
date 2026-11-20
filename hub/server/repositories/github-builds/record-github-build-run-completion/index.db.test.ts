import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import type { BuildState } from "../../../generated/prisma/client"
import { prisma } from "../../../integrations/prisma"
import { recordGitHubBuildRunCompletion } from "."

async function createBuild(state: BuildState = "successful") {
  const repository = await prisma.repository.create({
    data: { nameWithOwner: `octo/${randomUUID()}`, defaultBranch: "main" },
  })
  const prototype = await prisma.prototype.create({
    data: { repositoryId: repository.id, branchName: "proto/welcome" },
  })
  return prisma.build.create({
    data: {
      prototypeId: prototype.id,
      number: 1,
      state,
      commitSha: "a".repeat(40),
      githubWorkflowRunId: 100n,
      githubWorkflowRunAttempt: 2,
      distDigest: state === "successful" ? "sha256:" + "b".repeat(64) : null,
      artifacts:
        state === "successful"
          ? {
              create: {
                kind: "dist",
                path: "dist/index.html",
                storageKey: "retained-dist",
                byteLength: 10,
              },
            }
          : undefined,
    },
    include: { artifacts: true },
  })
}

describe("recordGitHubBuildRunCompletion()", () => {
  it("records another run's pass without marking the owning run complete", async () => {
    const build = await createBuild()
    const completedAt = new Date("2026-11-18T12:00:00Z")

    await expect(
      recordGitHubBuildRunCompletion(prisma, {
        buildId: build.id,
        run: { runId: 101n, runAttempt: 1 },
        completedAt,
      }),
    ).resolves.toBe(true)

    expect(
      await prisma.build.findUniqueOrThrow({
        where: { id: build.id },
        include: { artifacts: true },
      }),
    ).toEqual(build)
    expect(
      await prisma.gitHubBuildRunCompletion.findMany({ where: { buildId: build.id } }),
    ).toMatchObject([{ buildId: build.id, githubWorkflowRunId: 101n, runAttempt: 1, completedAt }])

    await recordGitHubBuildRunCompletion(prisma, {
      buildId: build.id,
      run: { runId: 100n, runAttempt: 1 },
      completedAt,
    })
    expect(
      (await prisma.build.findUniqueOrThrow({ where: { id: build.id } })).workflowCompletedAt,
    ).toBeNull()

    await recordGitHubBuildRunCompletion(prisma, {
      buildId: build.id,
      run: { runId: 100n, runAttempt: 2 },
      completedAt,
    })
    const completed = await prisma.build.findUniqueOrThrow({
      where: { id: build.id },
      include: { artifacts: true },
    })
    expect(completed).toEqual({
      ...build,
      workflowCompletedAt: completedAt,
      updatedAt: completed.updatedAt,
    })
  })

  it("retains one completion at the newest attempt across concurrent and stale passes", async () => {
    const build = await createBuild()
    const completedAt = new Date("2026-11-18T12:03:00Z")
    await Promise.all(
      [2, 3, 1, 3].map((runAttempt) =>
        recordGitHubBuildRunCompletion(prisma, {
          buildId: build.id,
          run: { runId: 101n, runAttempt },
          completedAt: runAttempt === 3 ? completedAt : new Date("2026-11-18T12:01:00Z"),
        }),
      ),
    )
    const [newest] = await prisma.gitHubBuildRunCompletion.findMany({
      where: { buildId: build.id },
    })
    expect(newest).toMatchObject({
      buildId: build.id,
      githubWorkflowRunId: 101n,
      runAttempt: 3,
      completedAt,
    })

    for (const runAttempt of [1, 3]) {
      await recordGitHubBuildRunCompletion(prisma, {
        buildId: build.id,
        run: { runId: 101n, runAttempt },
        completedAt: new Date("2026-11-18T13:00:00Z"),
      })
    }

    expect(
      await prisma.gitHubBuildRunCompletion.findMany({ where: { buildId: build.id } }),
    ).toEqual([newest])
    expect(
      await prisma.build.findUniqueOrThrow({
        where: { id: build.id },
        include: { artifacts: true },
      }),
    ).toEqual(build)
  })

  it("does not record a completed pass for a running Build", async () => {
    const build = await createBuild("running")

    await expect(
      recordGitHubBuildRunCompletion(prisma, {
        buildId: build.id,
        run: { runId: 100n, runAttempt: 2 },
        completedAt: new Date(),
      }),
    ).resolves.toBe(false)

    expect(await prisma.gitHubBuildRunCompletion.count()).toBe(0)
    expect(
      await prisma.build.findUniqueOrThrow({
        where: { id: build.id },
        include: { artifacts: true },
      }),
    ).toEqual(build)
  })

  it("marks only the exact failed owning run complete and preserves its failure and artifacts", async () => {
    const build = await createBuild("failed")
    const owner = await prisma.user.create({ data: {} })
    await prisma.prototype.update({
      where: { id: build.prototypeId },
      data: { authorId: owner.id },
    })
    await prisma.build.update({
      where: { id: build.id },
      data: {
        failureSummary: "The package is invalid.",
        startedAt: new Date("2026-11-18T11:00:00Z"),
        finishedAt: new Date("2026-11-18T11:10:00Z"),
        artifacts: {
          create: {
            kind: "dist",
            path: "dist/retained.html",
            storageKey: "retained-failure-artifact",
            byteLength: 10,
          },
        },
      },
    })
    const before = await prisma.build.findUniqueOrThrow({
      where: { id: build.id },
      include: { artifacts: true, prototype: true },
    })
    const completedAt = new Date("2026-11-18T12:00:00Z")
    for (const run of [
      { runId: 100n, runAttempt: 1 },
      { runId: 100n, runAttempt: 3 },
      { runId: 101n, runAttempt: 2 },
    ]) {
      await expect(
        recordGitHubBuildRunCompletion(prisma, { buildId: build.id, run, completedAt }),
      ).resolves.toBe(false)
    }
    expect(
      await prisma.build.findUniqueOrThrow({
        where: { id: build.id },
        include: { artifacts: true, prototype: true },
      }),
    ).toEqual(before)

    await expect(
      recordGitHubBuildRunCompletion(prisma, {
        buildId: build.id,
        run: { runId: 100n, runAttempt: 2 },
        completedAt,
      }),
    ).resolves.toBe(true)
    const after = await prisma.build.findUniqueOrThrow({
      where: { id: build.id },
      include: { artifacts: true, prototype: true },
    })
    expect(after).toEqual({
      ...before,
      workflowCompletedAt: completedAt,
      updatedAt: after.updatedAt,
    })
    expect(await prisma.gitHubBuildRunCompletion.count({ where: { buildId: build.id } })).toBe(0)
  })
})
