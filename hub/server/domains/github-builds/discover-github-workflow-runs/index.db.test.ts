import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import type { BuildState } from "../../../generated/prisma/client"
import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types"
import { prisma } from "../../../integrations/prisma"
import { prepareGitHubBuild } from "../../../repositories/github-builds/prepare-github-build"
import { discoverGitHubWorkflowRuns } from "."

const createdAfter = new Date(Date.now() - 60 * 60 * 1_000)

function workflowRun(githubRepositoryId: number, fields: Partial<GitHubWorkflowRun> = {}) {
  return {
    id: randomInt(1, 2 ** 31),
    runAttempt: 1,
    path: ".github/workflows/replica.yml",
    event: "push",
    headBranch: `prototype/${randomUUID()}`,
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
    id: repository.id,
    githubRepositoryId,
    async saveBuild(
      run: GitHubWorkflowRun,
      state: BuildState,
      { attempt = run.runAttempt, completed = false } = {},
    ) {
      const prototype =
        (await prisma.prototype.findFirst({
          where: { repositoryId: repository.id, branchName: run.headBranch! },
        })) ??
        (await prisma.prototype.create({
          data: { repositoryId: repository.id, branchName: run.headBranch! },
        }))
      number += 1
      return prisma.build.create({
        data: {
          prototypeId: prototype.id,
          commitSha: run.headSha,
          number,
          state,
          githubWorkflowRunId: run.id,
          githubWorkflowRunAttempt: attempt,
          workflowCreatedAt: run.createdAt,
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
    const rerunAfterSuccess = workflowRun(id, { runAttempt: 2 })
    const installer = workflowRun(id, { headBranch: "replica/install-workflow" })
    await repository.saveBuild(queued, "queued")
    await repository.saveBuild(awaitingScreenshots, "successful")
    await repository.saveBuild(finished, "successful", { completed: true })
    await repository.saveBuild(superseded, "superseded")
    await repository.saveBuild(failed, "failed", { completed: true })
    await repository.saveBuild(rerunAfterFailure, "failed", { attempt: 1, completed: true })
    await repository.saveBuild(rerunAfterSuccess, "successful", { attempt: 1, completed: true })
    const runs = [
      unseen,
      queued,
      awaitingScreenshots,
      finished,
      superseded,
      failed,
      rerunAfterFailure,
      rerunAfterSuccess,
      installer,
    ]
    const listWorkflowRuns = vi.fn((githubRepositoryId: number) =>
      Promise.resolve(githubRepositoryId === id ? runs : []),
    )

    const jobs = await discoverGitHubWorkflowRuns(
      {
        database: prisma,
        listWorkflowRuns,
        listBranchHeads: () => Promise.resolve([]),
        logger: { warn: vi.fn() },
      },
      { createdAfter },
    )

    expect(listWorkflowRuns).toHaveBeenCalledWith(id, createdAfter)
    const discovered = jobs.filter((job) => job.githubRepositoryId === id).map((job) => job.runId)
    expect(discovered.sort()).toEqual(
      [unseen, queued, awaitingScreenshots, rerunAfterFailure, rerunAfterSuccess]
        .map((run) => run.id)
        .sort(),
    )
  })

  it("does not repeatedly enqueue runs that reuse a settled commit or lost Build ownership", async () => {
    const repository = await createRepository()
    const settledOwner = workflowRun(repository.githubRepositoryId, { id: 100 })
    const reused = { ...settledOwner, id: 102 }
    const old = workflowRun(repository.githubRepositoryId, { id: 200 })
    const owner = { ...old, id: 201 }
    await repository.saveBuild(settledOwner, "successful", { completed: true })
    await repository.saveBuild(owner, "running")

    const jobs = await discoverGitHubWorkflowRuns(
      {
        database: prisma,
        listWorkflowRuns: () => Promise.resolve([settledOwner, reused, old, owner]),
        listBranchHeads: () => Promise.resolve([]),
        logger: { warn: vi.fn() },
      },
      { createdAfter },
    )

    expect(jobs).toEqual([{ githubRepositoryId: repository.githubRepositoryId, runId: owner.id }])
  })

  it("does not mistake another repository, branch, or commit for a settled Build", async () => {
    const repository = await createRepository()
    const other = await createRepository()
    const original = workflowRun(repository.githubRepositoryId)
    await repository.saveBuild(original, "successful", { completed: true })
    const differentBranch = { ...original, id: original.id + 1, headBranch: "proto/other" }
    const differentCommit = { ...original, id: original.id + 2, headSha: "b".repeat(40) }
    const differentRepository = workflowRun(repository.githubRepositoryId)
    await other.saveBuild(differentRepository, "successful", { completed: true })

    const jobs = await discoverGitHubWorkflowRuns(
      {
        database: prisma,
        listWorkflowRuns: (id) =>
          Promise.resolve(
            id === repository.githubRepositoryId
              ? [differentBranch, differentCommit, differentRepository]
              : [],
          ),
        listBranchHeads: () => Promise.resolve([]),
        logger: { warn: vi.fn() },
      },
      { createdAfter },
    )

    expect(jobs.map((job) => job.runId).sort()).toEqual(
      [differentBranch.id, differentCommit.id, differentRepository.id].sort(),
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
        listBranchHeads: () => Promise.resolve([]),
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

  it("selects an existing Build at the polled branch head without rewriting it or creating unmatched Builds", async () => {
    const repository = await createRepository()
    const branchName = "prototype/welcome"
    const firstRun = {
      runId: 100n,
      runAttempt: 1,
      workflowUrl: "https://github.com/o/r/actions/runs/100",
      createdAt: new Date(Date.now() - 120_000),
    }
    const secondRun = {
      ...firstRun,
      runId: 101n,
      createdAt: new Date(Date.now() - 60_000),
    }
    const first = await prepareGitHubBuild(prisma, {
      githubRepositoryId: repository.githubRepositoryId,
      branchName,
      commitSha: "a".repeat(40),
      run: firstRun,
      author: null,
    })
    if (first.status !== "ready") throw new Error("The fixture Build must exist.")
    await prisma.build.update({
      where: { id: first.buildId },
      data: {
        state: "successful",
        distDigest: "sha256:" + "a".repeat(64),
        artifacts: {
          create: {
            kind: "dist",
            path: "dist/index.html",
            storageKey: "immutable-test-dist",
            byteLength: 20,
          },
        },
      },
    })
    const second = await prepareGitHubBuild(prisma, {
      githubRepositoryId: repository.githubRepositoryId,
      branchName,
      commitSha: "b".repeat(40),
      run: secondRun,
      author: null,
    })
    if (second.status !== "ready") throw new Error("The second fixture Build must exist.")
    await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "prototype/unbuilt" },
    })
    const before = await prisma.build.findMany({
      orderBy: { number: "asc" },
      include: { artifacts: true },
    })
    const listBranchHeads = vi.fn(() =>
      Promise.resolve([
        { branchName, commitSha: "a".repeat(40) },
        { branchName: "prototype/unbuilt", commitSha: "c".repeat(40) },
        { branchName: "prototype/unknown", commitSha: "d".repeat(40) },
      ]),
    )
    const listWorkflowRuns = vi.fn(async () => {
      const prototype = await prisma.prototype.findFirstOrThrow({
        where: { repositoryId: repository.id, branchName },
      })
      expect(prototype.currentBuildId).toBe(first.buildId)
      return []
    })

    await expect(
      discoverGitHubWorkflowRuns(
        { database: prisma, listBranchHeads, listWorkflowRuns, logger: { warn: vi.fn() } },
        { createdAfter },
      ),
    ).resolves.toEqual([])
    expect(listBranchHeads).toHaveBeenCalledWith(repository.githubRepositoryId)
    expect(listWorkflowRuns).toHaveBeenCalled()
    expect(
      await prisma.build.findMany({ orderBy: { number: "asc" }, include: { artifacts: true } }),
    ).toEqual(before)
    expect(await prisma.prototype.count()).toBe(2)
    const observation = await prisma.branchHeadObservation.findUniqueOrThrow({
      where: {
        repositoryId_branchName_commitSha: {
          repositoryId: repository.id,
          branchName,
          commitSha: "a".repeat(40),
        },
      },
    })
    expect(observation.buildId).toBe(first.buildId)
    expect(observation.lastObservedAt.getTime()).toBeGreaterThan(secondRun.createdAt.getTime())
    expect(
      await prisma.prototype.findFirstOrThrow({
        where: { repositoryId: repository.id, branchName },
      }),
    ).toMatchObject({ currentBuildRunCreatedAt: secondRun.createdAt })

    await prepareGitHubBuild(prisma, {
      githubRepositoryId: repository.githubRepositoryId,
      branchName,
      commitSha: "b".repeat(40),
      run: secondRun,
      author: null,
    })
    expect(
      await prisma.prototype.findFirstOrThrow({
        where: { repositoryId: repository.id, branchName },
      }),
    ).toMatchObject({ currentBuildId: first.buildId })

    const thirdRun = {
      ...secondRun,
      runId: 102n,
      workflowUrl: "https://github.com/o/r/actions/runs/102",
      createdAt: new Date(secondRun.createdAt.getTime() + 30_000),
    }
    expect(thirdRun.createdAt.getTime()).toBeLessThan(observation.lastObservedAt.getTime())
    const third = await prepareGitHubBuild(prisma, {
      githubRepositoryId: repository.githubRepositoryId,
      branchName,
      commitSha: "c".repeat(40),
      run: thirdRun,
      author: null,
    })
    if (third.status !== "ready") throw new Error("The new fixture Build must exist.")
    expect(
      await prisma.prototype.findFirstOrThrow({
        where: { repositoryId: repository.id, branchName },
      }),
    ).toMatchObject({
      currentBuildId: third.buildId,
      currentBuildRunCreatedAt: thirdRun.createdAt,
    })
  })

  it("does not change an already selected Build or fence out newer runs with the poll time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const repository = await createRepository()
    const input = {
      githubRepositoryId: repository.githubRepositoryId,
      branchName: "proto/welcome",
      commitSha: "a".repeat(40),
      run: {
        runId: 100n,
        runAttempt: 1,
        workflowUrl: "https://github.com/o/r/actions/runs/100",
        createdAt: new Date("2026-11-18T10:00:00Z"),
      },
      author: null,
    }
    const first = await prepareGitHubBuild(prisma, input)
    if (first.status !== "ready") throw new Error("The fixture Build must exist.")
    const before = await prisma.prototype.findFirstOrThrow({
      where: { repositoryId: repository.id, branchName: input.branchName },
    })
    const polledAt = new Date("2026-11-18T13:00:00Z")
    vi.setSystemTime(polledAt)

    await discoverGitHubWorkflowRuns(
      {
        database: prisma,
        listBranchHeads: () =>
          Promise.resolve([{ branchName: input.branchName, commitSha: input.commitSha }]),
        listWorkflowRuns: () => Promise.resolve([]),
        logger: { warn: vi.fn() },
      },
      { createdAfter },
    )
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before)
    expect(
      await prisma.branchHeadObservation.findUniqueOrThrow({
        where: {
          repositoryId_branchName_commitSha: {
            repositoryId: repository.id,
            branchName: input.branchName,
            commitSha: input.commitSha,
          },
        },
      }),
    ).toMatchObject({ buildId: first.buildId, lastObservedAt: polledAt })

    const newerRun = { ...input.run, runId: 101n, createdAt: new Date("2026-11-18T11:00:00Z") }
    const newer = await prepareGitHubBuild(prisma, {
      ...input,
      commitSha: "b".repeat(40),
      run: newerRun,
    })
    if (newer.status !== "ready") throw new Error("The newer fixture Build must exist.")
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({
      currentBuildId: newer.buildId,
      currentBuildRunCreatedAt: newerRun.createdAt,
    })
  })

  it("does not let a delayed branch response undo a newer workflow selection", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const polledAt = new Date("2026-11-18T12:00:00Z")
    vi.setSystemTime(polledAt)
    const repository = await createRepository()
    const branchName = "prototype/welcome"
    const input = {
      githubRepositoryId: repository.githubRepositoryId,
      branchName,
      commitSha: "a".repeat(40),
      run: {
        runId: 100n,
        runAttempt: 1,
        workflowUrl: "https://github.com/o/r/actions/runs/100",
        createdAt: new Date("2026-11-18T11:00:00Z"),
      },
      author: null,
    }
    await prepareGitHubBuild(prisma, input)
    let newerBuildId: string | undefined

    await discoverGitHubWorkflowRuns(
      {
        database: prisma,
        listBranchHeads: async () => {
          vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
          const newer = await prepareGitHubBuild(prisma, {
            ...input,
            commitSha: "b".repeat(40),
            run: {
              ...input.run,
              runId: 101n,
              createdAt: new Date("2026-11-18T12:00:30Z"),
            },
          })
          if (newer.status !== "ready") throw new Error("The newer fixture Build must exist.")
          newerBuildId = newer.buildId
          return [{ branchName, commitSha: input.commitSha }]
        },
        listWorkflowRuns: () => Promise.resolve([]),
        logger: { warn: vi.fn() },
      },
      { createdAfter },
    )

    expect(newerBuildId).toBeDefined()
    expect(
      await prisma.prototype.findFirstOrThrow({
        where: { repositoryId: repository.id, branchName },
      }),
    ).toMatchObject({
      currentBuildId: newerBuildId,
      currentBuildRunCreatedAt: new Date("2026-11-18T12:00:30Z"),
    })
  })
})
