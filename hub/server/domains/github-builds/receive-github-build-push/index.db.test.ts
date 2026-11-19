import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import type {
  GitHubWorkflowArtifact,
  GitHubWorkflowRun,
} from "../../../integrations/github/create-github-actions-client/types"
import { prisma } from "../../../integrations/prisma"
import { createZipArchive } from "../../../test/create-zip-archive"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types"
import { extractDistPackage } from "../../build-artifacts/extract-dist-package"
import { distArtifactName, screenshotArtifactName } from "../constants"
import { importGitHubWorkflowRun } from "../import-github-workflow-run"
import { receiveGitHubScreenshotPush } from "../receive-github-screenshot-push"
import { receiveGitHubBuildPush } from "."

const logger = { info() {}, warn() {} }
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const dist = createZipArchive([{ name: "dist/index.html", bytes: "<h1>Home</h1>" }])

function createImmutableStorage(): ArtifactStorage {
  const objects = new Map<string, Uint8Array>()
  return {
    isReady: () => Promise.resolve(true),
    read: (key) => {
      const bytes = objects.get(key)
      return Promise.resolve(bytes ? { status: "ok", bytes } : { status: "not-found" })
    },
    write: (key, bytes) => {
      if (objects.has(key)) return Promise.resolve({ status: "already-exists" })
      objects.set(key, bytes)
      return Promise.resolve({ status: "ok" })
    },
    delete: () => Promise.reject(new Error("Pushed Build imports must not delete artifacts.")),
  }
}

async function createFixture() {
  const githubRepositoryId = randomInt(1, 2 ** 31)
  await prisma.repository.create({
    data: { githubRepositoryId, nameWithOwner: `octo/${randomUUID()}`, defaultBranch: "main" },
  })
  const run: GitHubWorkflowRun = {
    id: randomInt(1, 2 ** 31),
    runAttempt: 1,
    path: ".github/workflows/replica.yml",
    event: "push",
    headBranch: "prototype/welcome",
    headSha: "a".repeat(40),
    status: "in_progress",
    conclusion: null,
    htmlUrl: "https://github.com/octo/proto/actions/runs/1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:01:00Z"),
    repositoryId: githubRepositoryId,
    actor: { id: 9, login: "octocat", avatarUrl: null },
  }
  const state: { run: GitHubWorkflowRun | null } = { run }
  const packages = new Map<string, Buffer>()
  const dependencies = {
    database: prisma,
    storage: createImmutableStorage(),
    logger,
    client: {
      getWorkflowRun: () => Promise.resolve(state.run && { ...state.run }),
      listRunArtifacts: (_runId: number, name: string) =>
        Promise.resolve<GitHubWorkflowArtifact[]>(
          packages.has(name)
            ? [{ id: name === distArtifactName ? 1 : 2, name, sizeInBytes: 1, expired: false }]
            : [],
        ),
      downloadArtifact: (id: number) => {
        const bytes = packages.get(id === 1 ? distArtifactName : screenshotArtifactName)
        return Promise.resolve(
          bytes
            ? { status: "ok" as const, bytes: Buffer.from(bytes) }
            : { status: "gone" as const },
        )
      },
    },
  }
  const identity = {
    githubRepositoryId,
    repository: "octo/proto",
    branchName: "prototype/welcome",
    commitSha: run.headSha,
    runId: run.id,
    runAttempt: 1,
  }
  function findBuilds() {
    return prisma.build.findMany({
      where: { prototype: { repository: { githubRepositoryId } } },
      include: { artifacts: { orderBy: { path: "asc" } } },
    })
  }
  function importRun() {
    return importGitHubWorkflowRun(dependencies, { githubRepositoryId, runId: run.id })
  }
  return { state, dependencies, identity, findBuilds, packages, importRun }
}

describe("receiveGitHubBuildPush", () => {
  it("imports a pushed dist once and treats a repeated push as unchanged", async () => {
    const { dependencies, identity, findBuilds } = await createFixture()

    const first = await receiveGitHubBuildPush(dependencies, identity, dist)
    expect(first.status).toBe("imported")
    await expect(receiveGitHubBuildPush(dependencies, identity, dist)).resolves.toEqual({
      status: "unchanged",
      buildId: "buildId" in first ? first.buildId : undefined,
    })

    const builds = await findBuilds()
    expect(builds).toHaveLength(1)
    expect(builds[0]).toMatchObject({
      state: "successful",
      distDigest: extractDistPackage(dist).distDigest,
    })
    expect(builds[0]?.artifacts.map(({ path }) => path)).toEqual(["dist/index.html"])
  })

  it("records an invalid package as a failed Build and refuses the same attempt again", async () => {
    const { dependencies, identity, findBuilds } = await createFixture()
    const invalid = createZipArchive([{ name: "dist/app.js", bytes: "1" }])

    await expect(receiveGitHubBuildPush(dependencies, identity, invalid)).resolves.toMatchObject({
      status: "failed",
    })
    await expect(receiveGitHubBuildPush(dependencies, identity, dist)).resolves.toMatchObject({
      status: "rejected",
    })
    expect((await findBuilds()).map(({ state }) => state)).toEqual(["failed"])
  })

  it("keeps pushed dist immutable while pull recovery attaches screenshots and records completion", async () => {
    const { state, dependencies, identity, findBuilds, packages, importRun } = await createFixture()
    const pushed = await receiveGitHubBuildPush(dependencies, identity, dist)
    const [before] = await findBuilds()
    expect(before?.workflowCompletedAt).toBeNull()
    packages.set(
      distArtifactName,
      createZipArchive([{ name: "dist/index.html", bytes: "<h1>Different artifact</h1>" }]),
    )
    packages.set(
      screenshotArtifactName,
      createZipArchive([
        {
          name: "screenshots.json",
          bytes: JSON.stringify({ version: 1, distDigest: extractDistPackage(dist).distDigest }),
        },
        { name: "screenshots/desktop.png", bytes: png },
      ]),
    )
    if (!state.run) throw new Error("The fixture run must exist.")
    state.run = {
      ...state.run,
      status: "completed",
      conclusion: "success",
      updatedAt: new Date("2026-01-01T00:05:00Z"),
    }

    await expect(importRun()).resolves.toEqual({ dist: "unchanged", screenshots: "attached" })
    const builds = await findBuilds()
    expect(builds).toHaveLength(1)
    expect(builds[0]).toMatchObject({
      id: "buildId" in pushed ? pushed.buildId : undefined,
      state: "successful",
      distDigest: extractDistPackage(dist).distDigest,
      workflowCompletedAt: state.run.updatedAt,
    })
    expect(builds[0]?.artifacts.filter(({ kind }) => kind === "dist")).toEqual(before?.artifacts)
    expect(builds[0]?.artifacts.map(({ path }) => path)).toEqual([
      "dist/index.html",
      "screenshots/desktop.png",
    ])
  })

  it("keeps a recovered dist unchanged when a delayed push arrives", async () => {
    const { dependencies, identity, findBuilds, packages, importRun } = await createFixture()
    packages.set(distArtifactName, dist)
    await expect(importRun()).resolves.toEqual({ dist: "imported", screenshots: "absent" })
    const [before] = await findBuilds()

    await expect(
      receiveGitHubBuildPush(
        dependencies,
        identity,
        createZipArchive([{ name: "dist/index.html", bytes: "<h1>Delayed push</h1>" }]),
      ),
    ).resolves.toEqual({ status: "unchanged", buildId: before?.id })
    expect(await findBuilds()).toEqual([before])
  })

  it.each([
    ["commit", { commitSha: "b".repeat(40) }],
    ["branch", { branchName: "other" }],
    ["attempt", { runAttempt: 2 }],
  ])("rejects a token whose %s differs from GitHub's run", async (_field, change) => {
    const { dependencies, identity, findBuilds } = await createFixture()
    await expect(
      receiveGitHubBuildPush(dependencies, { ...identity, ...change }, dist),
    ).resolves.toMatchObject({ status: "rejected" })
    expect(await findBuilds()).toEqual([])
  })

  it("reports unknown repositories and unreadable runs without creating Builds", async () => {
    const { state, dependencies, identity, findBuilds } = await createFixture()
    const unknownRepositoryId = identity.githubRepositoryId + 1
    if (state.run) state.run = { ...state.run, repositoryId: unknownRepositoryId }
    await expect(
      receiveGitHubBuildPush(
        dependencies,
        { ...identity, githubRepositoryId: unknownRepositoryId },
        dist,
      ),
    ).resolves.toEqual({ status: "unknown-repository" })
    expect(await prisma.repository.count()).toBe(1)
    expect(await prisma.prototype.count()).toBe(0)
    expect(await findBuilds()).toEqual([])
    state.run = null
    await expect(receiveGitHubBuildPush(dependencies, identity, dist)).resolves.toEqual({
      status: "unavailable",
    })
    expect(await findBuilds()).toEqual([])
  })
})

describe("receiveGitHubScreenshotPush", () => {
  it("attaches screenshots only after the commit's dist and only for that dist", async () => {
    const { dependencies, identity, findBuilds, importRun } = await createFixture()
    const write = vi.spyOn(dependencies.storage, "write")
    function screenshots(distDigest: string) {
      return createZipArchive([
        { name: "screenshots.json", bytes: JSON.stringify({ version: 1, distDigest }) },
        { name: "screenshots/desktop.png", bytes: png },
      ])
    }
    const { distDigest } = extractDistPackage(dist)
    await importRun()

    await expect(
      receiveGitHubScreenshotPush(dependencies, identity, screenshots(distDigest)),
    ).resolves.toMatchObject({ status: "not-ready" })
    expect(write).not.toHaveBeenCalled()
    await receiveGitHubBuildPush(dependencies, identity, dist)
    write.mockClear()
    await expect(
      receiveGitHubScreenshotPush(dependencies, identity, screenshots("sha256:" + "0".repeat(64))),
    ).resolves.toMatchObject({ status: "digest-mismatch" })
    expect(write).not.toHaveBeenCalled()
    expect((await findBuilds())[0]?.artifacts.map(({ path }) => path)).toEqual(["dist/index.html"])
    await expect(
      receiveGitHubScreenshotPush(dependencies, identity, screenshots(distDigest)),
    ).resolves.toMatchObject({ status: "attached" })

    expect((await findBuilds())[0]?.artifacts.map(({ path }) => path)).toEqual([
      "dist/index.html",
      "screenshots/desktop.png",
    ])
  })

  it("does not create repositories or Builds for an unknown screenshot sender", async () => {
    const { dependencies, identity } = await createFixture()
    const bytes = createZipArchive([
      {
        name: "screenshots.json",
        bytes: JSON.stringify({ version: 1, distDigest: extractDistPackage(dist).distDigest }),
      },
      { name: "screenshots/desktop.png", bytes: png },
    ])

    await expect(
      receiveGitHubScreenshotPush(
        dependencies,
        { ...identity, githubRepositoryId: identity.githubRepositoryId + 1 },
        bytes,
      ),
    ).resolves.toEqual({ status: "not-ready" })
    expect(await prisma.repository.count()).toBe(1)
    expect(await prisma.prototype.count()).toBe(0)
    expect(await prisma.build.count()).toBe(0)
    expect(await prisma.buildArtifact.count()).toBe(0)
  })
})
