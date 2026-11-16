import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"
import pino from "pino"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { prisma } from "../../../integrations/prisma"
import type { LocalRepositoryDiscovery } from "../../../integrations/git/discover-local-repositories/types"
import type { LocalReplicaBuildRunner } from "../../../integrations/local-replica-build/run-local-replica-build/types"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types"
import { synchronizeLocalBuilds } from "."

const execFileAsync = promisify(execFile)
const logger = pino({ level: "silent" })

function createRoot() {
  const root = resolve(`server/domains/local-builds/synchronize-local-builds/.test-${randomUUID()}`)
  onTestFinished(() => rm(root, { force: true, recursive: true }))
  return root
}

async function createLocalDeveloper() {
  return prisma.user.create({
    data: {
      externalIdentities: {
        create: {
          provider: "local",
          issuer: "local",
          subject: "local-developer",
        },
      },
    },
  })
}

function createMemoryStorage() {
  const files = new Map<string, Uint8Array>()
  const storage: ArtifactStorage = {
    isReady() {
      return Promise.resolve(true)
    },
    read(key) {
      const bytes = files.get(key)
      return Promise.resolve(bytes ? { status: "ok", bytes } : { status: "not-found" })
    },
    write(key, bytes) {
      if (files.has(key)) return Promise.resolve({ status: "already-exists" })
      files.set(key, bytes)
      return Promise.resolve({ status: "ok" })
    },
    delete(key) {
      return Promise.resolve(files.delete(key) ? { status: "ok" } : { status: "not-found" })
    },
  }
  return { files, storage }
}

async function createPackage(root: string, name: string, source = "built output") {
  const directory = `${root}/${name}`
  await mkdir(`${directory}/dist`, { recursive: true })
  await mkdir(`${directory}/screenshots`)
  await writeFile(`${directory}/dist/index.html`, source)
  await writeFile(`${directory}/screenshots/home.png`, Uint8Array.of(1, 2, 3))
  await writeFile(`${directory}/templates.json`, "{}")
  return directory
}

function discovery(
  repositories: Array<{
    path: string
    name: string
    branch?: string
    commitSha: string
  }>,
): LocalRepositoryDiscovery {
  return {
    failures: [],
    repositories: repositories.map((repository) => ({
      path: repository.path,
      name: repository.name,
      defaultBranch: repository.branch ?? "main",
      branches: [
        {
          name: repository.branch ?? "main",
          commitSha: repository.commitSha,
          authorName: "Prototype Author",
          authorEmail: "author@example.com",
          authoredAt: new Date("2026-11-15T10:00:00Z"),
        },
      ],
    })),
  }
}

async function synchronize(
  root: string,
  discovered: LocalRepositoryDiscovery,
  runBuild: LocalReplicaBuildRunner,
  storage: ArtifactStorage,
) {
  return synchronizeLocalBuilds({
    database: prisma,
    storage,
    prototypeRoot: root,
    actionRoot: `${root}/action`,
    temporaryRoot: `${root}/temporary`,
    logger,
    discover: vi.fn().mockResolvedValue(discovered),
    runBuild,
  })
}

describe("synchronizeLocalBuilds()", () => {
  it("persists one successful Build for the exact committed source and its immutable artifacts", async () => {
    await createLocalDeveloper()
    const root = createRoot()
    const repositoryPath = `${root}/prototype`
    await mkdir(repositoryPath, { recursive: true })
    await execFileAsync("git", ["-C", repositoryPath, "init", "--initial-branch=main"])
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Prototype Author"])
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.email", "author@example.com"])
    await writeFile(`${repositoryPath}/source.txt`, "committed source")
    await execFileAsync("git", ["-C", repositoryPath, "add", "source.txt"])
    await execFileAsync("git", ["-C", repositoryPath, "commit", "--message=committed"])
    const commitSha = (
      await execFileAsync("git", ["-C", repositoryPath, "rev-parse", "HEAD"])
    ).stdout.trim()
    await writeFile(`${repositoryPath}/source.txt`, "uncommitted source")
    const packageDirectory = await createPackage(root, "package", "")
    const runBuild = vi.fn<LocalReplicaBuildRunner>(async (input) => {
      expect(input).toMatchObject({ repositoryPath, commitSha })
      const committedSource = (
        await execFileAsync("git", [
          "-C",
          input.repositoryPath,
          "show",
          `${input.commitSha}:source.txt`,
        ])
      ).stdout
      expect(await readFile(`${input.repositoryPath}/source.txt`, "utf8")).toBe(
        "uncommitted source",
      )
      await writeFile(`${packageDirectory}/dist/index.html`, committedSource)
      return { packageDirectory, cleanup: vi.fn().mockResolvedValue(undefined) }
    })
    const { files, storage } = createMemoryStorage()

    await expect(
      synchronize(
        root,
        discovery([{ path: repositoryPath, name: "prototype", commitSha }]),
        runBuild,
        storage,
      ),
    ).resolves.toMatchObject({ queued: 1, successful: 1, failed: 0 })

    const repository = await prisma.repository.findUniqueOrThrow({
      where: { localPath: repositoryPath },
      include: {
        branchHeadObservations: true,
        prototypes: {
          include: {
            builds: { include: { artifacts: true } },
            currentBuild: true,
          },
        },
      },
    })
    const prototype = repository.prototypes[0]!
    const build = prototype.builds[0]!
    expect(repository).toMatchObject({
      nameWithOwner: "local/prototype",
      defaultBranch: "main",
      localPath: repositoryPath,
    })
    expect(prototype).toMatchObject({ branchName: "main", currentBuildId: build.id })
    expect(build).toMatchObject({
      number: 1,
      state: "successful",
      commitSha,
      authorProvider: "local",
      authorName: "Prototype Author",
    })
    expect(repository.branchHeadObservations).toEqual([
      expect.objectContaining({ branchName: "main", commitSha, buildId: build.id }),
    ])
    expect(build.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "dist", path: "dist/index.html" }),
        expect.objectContaining({ kind: "screenshot", path: "screenshots/home.png" }),
        expect.objectContaining({ kind: "manifest", path: "templates.json" }),
      ]),
    )
    const sourceArtifact = build.artifacts.find(({ path }) => path === "dist/index.html")!
    expect(new TextDecoder().decode(files.get(sourceArtifact.storageKey))).toBe("committed source")
  })

  it("does not rebuild or duplicate records when a branch head is unchanged", async () => {
    await createLocalDeveloper()
    const root = createRoot()
    const repositoryPath = `${root}/prototype`
    const commitSha = "a".repeat(40)
    const discovered = discovery([{ path: repositoryPath, name: "prototype", commitSha }])
    const packageDirectory = await createPackage(root, "package")
    const runBuild = vi.fn<LocalReplicaBuildRunner>().mockResolvedValue({
      packageDirectory,
      cleanup: vi.fn().mockResolvedValue(undefined),
    })
    const { storage } = createMemoryStorage()

    await synchronize(root, discovered, runBuild, storage)
    const firstRecords = {
      repositories: await prisma.repository.findMany({
        orderBy: { id: "asc" },
        select: { id: true },
      }),
      prototypes: await prisma.prototype.findMany({
        orderBy: { id: "asc" },
        select: { id: true },
      }),
      builds: await prisma.build.findMany({ orderBy: { id: "asc" }, select: { id: true } }),
      observations: await prisma.branchHeadObservation.findMany({
        orderBy: { id: "asc" },
        select: { id: true },
      }),
      artifacts: await prisma.buildArtifact.findMany({
        orderBy: { path: "asc" },
        select: { id: true, storageKey: true },
      }),
    }
    const second = await synchronize(root, discovered, runBuild, storage)

    expect(second).toMatchObject({ queued: 0, unchanged: 1, successful: 0, failed: 0 })
    expect(runBuild).toHaveBeenCalledTimes(1)
    await expect(
      Promise.all([
        prisma.repository.findMany({ orderBy: { id: "asc" }, select: { id: true } }),
        prisma.prototype.findMany({ orderBy: { id: "asc" }, select: { id: true } }),
        prisma.build.findMany({ orderBy: { id: "asc" }, select: { id: true } }),
        prisma.branchHeadObservation.findMany({
          orderBy: { id: "asc" },
          select: { id: true },
        }),
        prisma.buildArtifact.findMany({
          orderBy: { path: "asc" },
          select: { id: true, storageKey: true },
        }),
      ]),
    ).resolves.toEqual([
      firstRecords.repositories,
      firstRecords.prototypes,
      firstRecords.builds,
      firstRecords.observations,
      firstRecords.artifacts,
    ])
  })

  it("persists a failed Build and continues to a successful repository", async () => {
    await createLocalDeveloper()
    const root = createRoot()
    const failedPath = `${root}/broken`
    const successfulPath = `${root}/working`
    const successfulPackage = await createPackage(root, "successful-package")
    const runBuild = vi.fn<LocalReplicaBuildRunner>(({ repositoryPath }) => {
      if (repositoryPath === failedPath) {
        return Promise.reject(new Error("prototype build failed"))
      }
      return Promise.resolve({
        packageDirectory: successfulPackage,
        cleanup: vi.fn().mockResolvedValue(undefined),
      })
    })
    const { storage } = createMemoryStorage()

    const summary = await synchronize(
      root,
      discovery([
        { path: failedPath, name: "broken", commitSha: "b".repeat(40) },
        { path: successfulPath, name: "working", commitSha: "c".repeat(40) },
      ]),
      runBuild,
      storage,
    )

    expect(summary).toMatchObject({ queued: 2, failed: 1, successful: 1 })
    expect(runBuild).toHaveBeenCalledTimes(2)
    const failed = await prisma.repository.findUniqueOrThrow({
      where: { localPath: failedPath },
      include: { prototypes: { include: { builds: { include: { artifacts: true } } } } },
    })
    const successful = await prisma.repository.findUniqueOrThrow({
      where: { localPath: successfulPath },
      include: {
        prototypes: {
          include: { currentBuild: true, builds: { include: { artifacts: true } } },
        },
      },
    })
    expect(failed.prototypes[0]).toMatchObject({ currentBuildId: null })
    expect(failed.prototypes[0]!.builds).toHaveLength(1)
    expect(failed.prototypes[0]!.builds[0]).toMatchObject({
      state: "failed",
      failureSummary: "prototype build failed",
      artifacts: [],
    })
    expect(failed.prototypes[0]!.builds[0]!.startedAt).toBeInstanceOf(Date)
    expect(failed.prototypes[0]!.builds[0]!.finishedAt).toBeInstanceOf(Date)
    expect(successful.prototypes[0]!.currentBuild).toMatchObject({ state: "successful" })
    expect(successful.prototypes[0]!.builds[0]!.artifacts).toHaveLength(3)
  })
})
