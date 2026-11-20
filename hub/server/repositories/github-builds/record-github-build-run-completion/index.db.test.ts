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

  it.each(["running", "failed"] as const)(
    "does not record a completed pass for a %s Build",
    async (state) => {
      const build = await createBuild(state)

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
    },
  )
})
