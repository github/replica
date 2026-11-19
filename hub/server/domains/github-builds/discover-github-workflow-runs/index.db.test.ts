import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import type { BuildState } from "../../../generated/prisma/client"
import type { GitHubWorkflowRun } from "../../../integrations/github/create-github-actions-client/types"
import { prisma } from "../../../integrations/prisma"
import { prepareGitHubBuild } from "../../../repositories/github-builds/prepare-github-build"
import { retireGitHubBranch } from "../../../repositories/prototypes/retire-github-branch"
import { refreshGitHubBranchHeads } from "../refresh-github-branch-heads"
import { discoverGitHubWorkflowRuns, type DiscoverGitHubWorkflowRunsDependencies } from "."

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

async function createBranchFixture() {
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
  const prepared = await prepareGitHubBuild(prisma, input)
  if (prepared.status !== "ready") throw new Error("The fixture Build must exist.")
  const prototype = await prisma.prototype.findFirstOrThrow({
    where: { repositoryId: repository.id, branchName: input.branchName },
  })
  function poll(
    commitSha = input.commitSha,
    dependencies: Partial<DiscoverGitHubWorkflowRunsDependencies> = {},
  ) {
    return discoverGitHubWorkflowRuns(
      {
        database: prisma,
        listBranchHeads: vi.fn(() =>
          Promise.resolve([{ branchName: input.branchName, commitSha }]),
        ),
        listWorkflowRuns: vi.fn(() => Promise.resolve([])),
        isAncestor: vi.fn(() => Promise.resolve(false)),
        logger: { warn: vi.fn() },
        ...dependencies,
      },
      { createdAfter },
    )
  }
  await poll()
  return {
    repository,
    input,
    prototypeId: prototype.id,
    buildId: prepared.buildId,
    poll,
    retire: (
      { deletedHeadSha }: { deletedHeadSha?: string } = { deletedHeadSha: input.commitSha },
    ) =>
      prisma.$transaction((transaction) =>
        retireGitHubBranch(transaction, {
          githubRepositoryId: repository.githubRepositoryId,
          branchName: input.branchName,
          deletedHeadSha,
        }),
      ),
    read: () => prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } }),
  }
}

describe("discoverGitHubWorkflowRuns", () => {
  it("refreshes other branch heads when one ancestry lookup fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const first = await createBranchFixture()
    await first.retire()
    const secondInput = {
      ...first.input,
      branchName: "proto/healthy",
      commitSha: "c".repeat(40),
      run: { ...first.input.run, runId: 101n },
    }
    const second = await prepareGitHubBuild(prisma, secondInput)
    if (second.status !== "ready") throw new Error("The second fixture Build must exist.")
    await prisma.$transaction((transaction) =>
      retireGitHubBranch(transaction, {
        githubRepositoryId: first.repository.githubRepositoryId,
        branchName: secondInput.branchName,
        deletedHeadSha: secondInput.commitSha,
      }),
    )
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
    const failure = new Error("GitHub comparison unavailable")

    await expect(
      refreshGitHubBranchHeads(
        {
          database: prisma,
          listBranchHeads: () =>
            Promise.resolve([
              { branchName: first.input.branchName, commitSha: "b".repeat(40) },
              { branchName: secondInput.branchName, commitSha: secondInput.commitSha },
            ]),
          isAncestor: () => Promise.reject(failure),
        },
        first.repository.githubRepositoryId,
      ),
    ).rejects.toThrow("GitHub branch head refresh failed")

    expect((await first.read()).branchDeletedAt).not.toBeNull()
    expect(
      await prisma.prototype.findFirstOrThrow({
        where: { repositoryId: first.repository.id, branchName: secondInput.branchName },
      }),
    ).toMatchObject({ branchDeletedAt: null, currentBuildId: second.buildId })
  })

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
        isAncestor: vi.fn(() => Promise.resolve(false)),
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
        isAncestor: vi.fn(() => Promise.resolve(false)),
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
        isAncestor: vi.fn(() => Promise.resolve(false)),
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
        isAncestor: vi.fn(() => Promise.resolve(false)),
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
        {
          database: prisma,
          isAncestor: vi.fn(() => Promise.resolve(false)),
          listBranchHeads,
          listWorkflowRuns,
          logger: { warn: vi.fn() },
        },
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
        isAncestor: vi.fn(() => Promise.resolve(false)),
        listBranchHeads: () =>
          Promise.resolve([{ branchName: input.branchName, commitSha: input.commitSha }]),
        listWorkflowRuns: () => Promise.resolve([]),
        logger: { warn: vi.fn() },
      },
      { createdAfter },
    )
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({
      currentBuildId: before.currentBuildId,
      currentBuildRunCreatedAt: before.currentBuildRunCreatedAt,
      branchHeadSha: input.commitSha,
      branchPresenceRevision: before.branchPresenceRevision + 1,
    })
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
        isAncestor: vi.fn(() => Promise.resolve(false)),
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

  it("restores an equal retired head without comparison, but not from a pre-deletion listing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const repository = await createRepository()
    const githubRepositoryId = repository.githubRepositoryId
    const branchName = "proto/welcome"
    const input = {
      githubRepositoryId,
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
    const first = await prepareGitHubBuild(prisma, input)
    if (first.status !== "ready") throw new Error("The fixture Build must exist.")
    const prototype = await prisma.prototype.findFirstOrThrow({
      where: { repositoryId: repository.id, branchName },
    })
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { name: "Welcome", description: "Saved description" },
    })
    const builds = await prisma.build.findMany({ where: { prototypeId: prototype.id } })
    function retire() {
      return prisma.$transaction((transaction) =>
        retireGitHubBranch(transaction, {
          githubRepositoryId,
          branchName,
          deletedHeadSha: input.commitSha,
        }),
      )
    }
    await retire()
    const isAncestor = vi.fn(() => Promise.resolve(false))
    const recreated = workflowRun(githubRepositoryId, { headBranch: branchName })
    function discover(
      at: string,
      heads: () => Promise<{ branchName: string; commitSha: string }[]>,
    ) {
      vi.setSystemTime(new Date(at))
      return discoverGitHubWorkflowRuns(
        {
          database: prisma,
          isAncestor,
          listBranchHeads: heads,
          listWorkflowRuns: () => Promise.resolve([recreated]),
          logger: { warn: vi.fn() },
        },
        { createdAfter },
      )
    }
    const listed = [{ branchName, commitSha: recreated.headSha }]
    async function branchDeletedAt() {
      return (await prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } }))
        .branchDeletedAt
    }

    await discover("2026-11-18T12:01:00Z", () => Promise.resolve([]))
    expect(await branchDeletedAt()).toEqual(new Date("2026-11-18T12:00:00Z"))

    await discover("2026-11-18T12:02:00Z", async () => {
      vi.setSystemTime(new Date("2026-11-18T12:03:00Z"))
      await retire()
      return listed
    })
    expect(await branchDeletedAt()).toEqual(new Date("2026-11-18T12:03:00Z"))

    const jobs = await discover("2026-11-18T12:04:00Z", () => Promise.resolve(listed))
    expect(jobs).toContainEqual({ githubRepositoryId, runId: recreated.id })
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } })).toMatchObject(
      { branchDeletedAt: null, name: "Welcome", description: "Saved description" },
    )
    expect(await prisma.build.findMany({ where: { prototypeId: prototype.id } })).toEqual(builds)
    expect(isAncestor).not.toHaveBeenCalled()
    await expect(
      prepareGitHubBuild(prisma, {
        ...input,
        commitSha: recreated.headSha,
        run: { ...input.run, runId: BigInt(recreated.id), createdAt: recreated.createdAt },
      }),
    ).resolves.toMatchObject({ status: "ready" })
  })

  it("restores the same identity when GitHub proves the retired head is an ancestor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    await prisma.prototype.update({
      where: { id: branch.prototypeId },
      data: { name: "Welcome", registeredAt: new Date(), description: "Retained" },
    })
    await branch.retire()
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
    const head = "b".repeat(40)
    const isAncestor = vi.fn(() => Promise.resolve(true))

    await branch.poll(head, { isAncestor })

    expect(isAncestor).toHaveBeenCalledWith(
      branch.repository.githubRepositoryId,
      branch.input.commitSha,
      head,
    )
    expect(await branch.read()).toMatchObject({
      branchDeletedAt: null,
      branchHeadSha: head,
      name: "Welcome",
      description: "Retained",
      registeredAt: new Date("2026-11-18T12:00:00Z"),
    })
    expect(await prisma.prototype.count()).toBe(1)
  })

  it("isolates an unrelated replacement from every older identity and rejects historical imports", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    const head = "b".repeat(40)
    const older = await prisma.prototype.create({
      data: {
        repositoryId: branch.repository.id,
        branchName: branch.input.branchName,
        branchDeletedAt: new Date("2026-11-18T09:00:00Z"),
        retiredHeadSha: head,
        name: "Older matching generation",
      },
    })
    const author = await prisma.user.create({ data: {} })
    await prisma.prototype.update({
      where: { id: branch.prototypeId },
      data: {
        name: "Saved prototype",
        description: "Saved description",
        startPage: "/saved",
        authorId: author.id,
        registeredAt: new Date(),
      },
    })
    await prisma.build.update({
      where: { id: branch.buildId },
      data: { state: "successful" },
    })
    await prisma.reviewThread.create({
      data: {
        repositoryId: branch.repository.id,
        prototypeId: branch.prototypeId,
        buildId: branch.buildId,
        anchor: { schemaVersion: 1, kind: "element", selector: "#content" },
        comments: {
          create: { authorId: author.id, authorLogin: "mona", body: "Retained review" },
        },
      },
    })
    await prisma.shareLink.create({
      data: {
        prototypeId: branch.prototypeId,
        buildId: branch.buildId,
        createdById: author.id,
        createdByLogin: "mona",
        publicId: randomUUID(),
        label: "Retained link",
        expiresAt: new Date("2026-12-18T12:00:00Z"),
      },
    })
    await branch.retire()
    const history = await prisma.prototype.findUniqueOrThrow({
      where: { id: branch.prototypeId },
      include: { builds: true, reviewThreads: { include: { comments: true } }, shareLinks: true },
    })
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
    const isAncestor = vi.fn(() => Promise.resolve(false))

    await branch.poll(head, { isAncestor })

    const replacement = await prisma.prototype.findFirstOrThrow({
      where: { repositoryId: branch.repository.id, branchDeletedAt: null },
      include: { builds: true, reviewThreads: true, shareLinks: true },
    })
    expect(replacement).toMatchObject({
      branchName: branch.input.branchName,
      branchHeadSha: head,
      branchIdentityStartedAt: new Date("2026-11-18T12:00:00Z"),
      registeredAt: null,
      authorId: null,
      description: null,
      startPage: null,
      currentBuildId: null,
      builds: [],
      reviewThreads: [],
      shareLinks: [],
    })
    expect([branch.prototypeId, older.id]).not.toContain(replacement.id)
    expect(replacement.name === null || replacement.name === branch.input.branchName).toBe(true)
    expect(isAncestor.mock.calls).toEqual([
      [branch.repository.githubRepositoryId, branch.input.commitSha, head],
    ])
    expect(
      await prisma.prototype.findUniqueOrThrow({
        where: { id: branch.prototypeId },
        include: { builds: true, reviewThreads: { include: { comments: true } }, shareLinks: true },
      }),
    ).toEqual(history)
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: older.id } })).toEqual(older)

    const rejected = await prepareGitHubBuild(prisma, {
      ...branch.input,
      commitSha: "c".repeat(40),
      run: { ...branch.input.run, runId: 101n },
    })
    expect(rejected.status).not.toBe("ready")
    expect(await prisma.build.count({ where: { prototypeId: replacement.id } })).toBe(0)
    const historicalRun = workflowRun(branch.repository.githubRepositoryId, {
      headBranch: branch.input.branchName,
      headSha: "c".repeat(40),
      createdAt: branch.input.run.createdAt,
    })
    const recreatedRun = workflowRun(branch.repository.githubRepositoryId, {
      headBranch: branch.input.branchName,
      headSha: "d".repeat(40),
      createdAt: new Date("2026-11-18T12:00:30Z"),
    })
    expect(
      await branch.poll(head, {
        listWorkflowRuns: () => Promise.resolve([historicalRun, recreatedRun]),
      }),
    ).toEqual([
      { githubRepositoryId: branch.repository.githubRepositoryId, runId: recreatedRun.id },
    ])
    const current = await prepareGitHubBuild(prisma, {
      ...branch.input,
      commitSha: head,
      run: { ...branch.input.run, runId: 102n },
    })
    if (current.status !== "ready") throw new Error("The confirmed current head must import.")
    expect(await prisma.build.findUniqueOrThrow({ where: { id: current.buildId } })).toMatchObject({
      prototypeId: replacement.id,
      number: 1,
    })

    vi.setSystemTime(new Date("2026-11-18T12:02:00Z"))
    await branch.retire({ deletedHeadSha: head })
    vi.setSystemTime(new Date("2026-11-18T12:03:00Z"))
    const compareAgain = vi.fn(() => Promise.resolve(false))
    await branch.poll(head, { isAncestor: compareAgain })
    expect(compareAgain).not.toHaveBeenCalled()
    expect(
      await prisma.prototype.findFirstOrThrow({
        where: { repositoryId: branch.repository.id, branchDeletedAt: null },
      }),
    ).toMatchObject({ id: replacement.id, registeredAt: null, description: null })
    expect(await prisma.prototype.count()).toBe(3)
  })

  it("does not resume from a replacement head observed before a delayed SHA-less deletion", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    const replacementHead = "b".repeat(40)
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
    await branch.poll(replacementHead)
    expect((await branch.read()).branchHeadSha).toBe(replacementHead)
    vi.setSystemTime(new Date("2026-11-18T12:02:00Z"))
    await branch.retire({})
    const history = await branch.read()
    expect(history.retiredHeadSha).toBeNull()
    vi.setSystemTime(new Date("2026-11-18T12:03:00Z"))
    const isAncestor = vi.fn(() => Promise.resolve(true))

    await branch.poll(replacementHead, { isAncestor })

    expect(isAncestor).not.toHaveBeenCalled()
    expect(await branch.read()).toEqual(history)
    expect(await prisma.build.count({ where: { prototypeId: branch.prototypeId } })).toBe(1)
    const active = await prisma.prototype.findFirstOrThrow({
      where: { repositoryId: branch.repository.id, branchDeletedAt: null },
    })
    expect(active).toMatchObject({ branchHeadSha: replacementHead, currentBuildId: null })
    expect(active.id).not.toBe(branch.prototypeId)
  })

  it.each([
    { name: "delete before push", order: [undefined, "deleted"] as const },
    { name: "push before delete", order: ["deleted", undefined] as const },
  ])("anchors on the deleted head from push evidence ($name)", async ({ order }) => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
    for (const evidence of order) {
      await branch.retire(evidence ? { deletedHeadSha: branch.input.commitSha } : {})
    }
    expect((await branch.read()).retiredHeadSha).toBe(branch.input.commitSha)
    await branch.retire({ deletedHeadSha: "c".repeat(40) })
    expect((await branch.read()).retiredHeadSha).toBe(branch.input.commitSha)
    vi.setSystemTime(new Date("2026-11-18T12:02:00Z"))
    const returning = "d".repeat(40)
    const isAncestor = vi.fn(() => Promise.resolve(true))

    await branch.poll(returning, { isAncestor })

    expect(isAncestor.mock.calls).toEqual([
      [branch.repository.githubRepositoryId, branch.input.commitSha, returning],
    ])
    expect(await branch.read()).toMatchObject({ branchDeletedAt: null, branchHeadSha: returning })
    expect(await prisma.prototype.count()).toBe(1)
  })

  it("ignores push evidence for a head the identity never accepted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
    await branch.retire({ deletedHeadSha: "e".repeat(40) })
    expect((await branch.read()).retiredHeadSha).toBeNull()
  })

  it("creates a separate unbuilt identity when the retired head is unknown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const repository = await createRepository()
    const branchName = "proto/unbuilt"
    await prisma.$transaction((transaction) =>
      retireGitHubBranch(transaction, {
        githubRepositoryId: repository.githubRepositoryId,
        branchName,
      }),
    )
    const retired = await prisma.prototype.findFirstOrThrow({
      where: { repositoryId: repository.id, branchName },
    })
    const isAncestor = vi.fn(() => Promise.resolve(true))
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))

    await discoverGitHubWorkflowRuns(
      {
        database: prisma,
        listBranchHeads: () => Promise.resolve([{ branchName, commitSha: "a".repeat(40) }]),
        listWorkflowRuns: () => Promise.resolve([]),
        isAncestor,
        logger: { warn: vi.fn() },
      },
      { createdAfter },
    )

    expect(isAncestor).not.toHaveBeenCalled()
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: retired.id } })).toEqual(retired)
    const active = await prisma.prototype.findFirstOrThrow({
      where: { repositoryId: repository.id, branchName, branchDeletedAt: null },
    })
    expect(active.id).not.toBe(retired.id)
    expect(active).toMatchObject({ registeredAt: null, currentBuildId: null })
    expect(await prisma.build.count()).toBe(0)
  })

  it("does not let a settled old Build suppress recovery for a separate identity at the same SHA", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    await prisma.build.update({
      where: { id: branch.buildId },
      data: { state: "successful", workflowCompletedAt: new Date() },
    })
    await branch.retire()
    await prisma.prototype.update({
      where: { id: branch.prototypeId },
      data: { retiredHeadSha: null },
    })
    const run = workflowRun(branch.repository.githubRepositoryId, {
      id: Number(branch.input.run.runId),
      headBranch: branch.input.branchName,
      headSha: branch.input.commitSha,
      createdAt: branch.input.run.createdAt,
    })
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
    const isAncestor = vi.fn(() => Promise.resolve(true))

    expect(
      await branch.poll(run.headSha, {
        isAncestor,
        listWorkflowRuns: () => Promise.resolve([run]),
      }),
    ).toEqual([{ githubRepositoryId: branch.repository.githubRepositoryId, runId: run.id }])
    expect(isAncestor).not.toHaveBeenCalled()
    const replacement = await prisma.prototype.findFirstOrThrow({
      where: { repositoryId: branch.repository.id, branchDeletedAt: null },
    })
    expect(replacement.id).not.toBe(branch.prototypeId)
    const prepared = await prepareGitHubBuild(prisma, branch.input)
    if (prepared.status !== "ready") throw new Error("The confirmed current head must import.")
    expect(prepared.buildId).not.toBe(branch.buildId)
    expect(await prisma.build.findUniqueOrThrow({ where: { id: prepared.buildId } })).toMatchObject(
      {
        prototypeId: replacement.id,
        commitSha: run.headSha,
      },
    )
    expect(await prisma.build.findUniqueOrThrow({ where: { id: branch.buildId } })).toMatchObject({
      prototypeId: branch.prototypeId,
      state: "successful",
    })
  })

  it("leaves retired history untouched and warns when ancestry cannot be established", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    await branch.retire()
    const retired = await branch.read()
    const warn =
      vi.fn<(context: { err: unknown; githubRepositoryId: number }, message: string) => void>()
    const error = new Error("GitHub comparison unavailable")
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))

    await branch.poll("b".repeat(40), {
      isAncestor: vi.fn(() => Promise.reject(error)),
      logger: { warn },
    })

    expect(await branch.read()).toEqual(retired)
    expect(await prisma.prototype.count()).toBe(1)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        githubRepositoryId: branch.repository.githubRepositoryId,
      }),
      expect.any(String),
    )
    const loggedError = warn.mock.calls[0]?.[0].err
    if (!(loggedError instanceof AggregateError)) throw new Error("Expected an aggregate error.")
    const failures: unknown[] = loggedError.errors
    const firstFailure = failures[0]
    if (!(firstFailure instanceof Error)) throw new Error("Expected a branch refresh error.")
    expect(firstFailure.cause).toBe(error)
  })

  it("does not overwrite a newer observation with a stale comparison for the same owner", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    await branch.retire()
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
    let newer = await branch.read()

    await branch.poll("b".repeat(40), {
      isAncestor: vi.fn(async () => {
        await branch.poll("c".repeat(40), { isAncestor: vi.fn(() => Promise.resolve(true)) })
        newer = await branch.read()
        return true
      }),
    })

    expect(await branch.read()).toEqual(newer)
    expect(newer).toMatchObject({ branchDeletedAt: null, branchHeadSha: "c".repeat(40) })
    expect(await prisma.prototype.count()).toBe(1)
  })

  it("does not overwrite a newer observation of the same SHA with a stale listing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    const before = await branch.read()
    let newer = before
    const stale = "b".repeat(40)
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))

    await branch.poll(stale, {
      listBranchHeads: async () => {
        await branch.poll()
        newer = await branch.read()
        return [{ branchName: branch.input.branchName, commitSha: stale }]
      },
    })

    expect(newer.branchPresenceRevision).toBeGreaterThan(before.branchPresenceRevision)
    expect(await branch.read()).toEqual(newer)
    expect(newer.branchHeadSha).toBe(branch.input.commitSha)
  })

  it("does not apply stale comparison evidence to a replaced owner", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    await branch.retire()
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
    let replacementId: string | undefined

    await branch.poll("b".repeat(40), {
      isAncestor: vi.fn(async () => {
        await branch.poll("c".repeat(40))
        replacementId = (
          await prisma.prototype.findFirstOrThrow({
            where: { repositoryId: branch.repository.id, branchDeletedAt: null },
          })
        ).id
        return true
      }),
    })

    expect(replacementId).toBeDefined()
    const active = await prisma.prototype.findMany({ where: { branchDeletedAt: null } })
    expect(active).toMatchObject([{ id: replacementId, branchHeadSha: "c".repeat(40) }])
    expect((await branch.read()).branchDeletedAt).not.toBeNull()
    expect(await prisma.prototype.count()).toBe(2)
  })

  it("keeps the first retirement head fixed when an older run is imported before redelivery", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
    const branch = await createBranchFixture()
    vi.setSystemTime(new Date("2026-11-18T12:00:30Z"))
    const historical = await prepareGitHubBuild(prisma, {
      ...branch.input,
      commitSha: "b".repeat(40),
      run: { ...branch.input.run, runId: 99n, createdAt: new Date("2026-11-18T09:00:00Z") },
    })
    expect(historical.status).toBe("ready")
    vi.setSystemTime(new Date("2026-11-18T12:01:00Z"))
    await branch.retire()
    const retired = await branch.read()
    expect(retired.retiredHeadSha).toBe(branch.input.commitSha)
    vi.setSystemTime(new Date("2026-11-18T12:02:00Z"))

    await prepareGitHubBuild(prisma, {
      ...branch.input,
      commitSha: "c".repeat(40),
      run: { ...branch.input.run, runId: 98n, createdAt: new Date("2026-11-18T08:00:00Z") },
    })
    await branch.retire()

    expect(await branch.read()).toMatchObject({
      retiredHeadSha: branch.input.commitSha,
      branchDeletedAt: new Date("2026-11-18T12:02:00Z"),
      registeredAt: null,
    })
    expect((await branch.read()).branchPresenceRevision).toBeGreaterThan(
      retired.branchPresenceRevision,
    )
    vi.setSystemTime(new Date("2026-11-18T12:03:00Z"))
    const isAncestor = vi.fn(() => Promise.resolve(false))
    await branch.poll("b".repeat(40), { isAncestor })
    expect(isAncestor).toHaveBeenCalledWith(
      branch.repository.githubRepositoryId,
      branch.input.commitSha,
      "b".repeat(40),
    )
    expect((await branch.read()).branchDeletedAt).not.toBeNull()
  })
})
