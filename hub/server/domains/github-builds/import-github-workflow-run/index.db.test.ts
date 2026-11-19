import { createHash, randomInt, randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma/index.ts"
import type {
  GitHubWorkflowArtifact,
  GitHubWorkflowRun,
} from "../../../integrations/github/create-github-actions-client/types.ts"
import { findBuildArtifact } from "../../../repositories/build-artifacts/find-build-artifact/index.ts"
import { createGitHubWebhookRouteDependencies } from "../../../routes/api/github/webhooks/create-github-webhook-route-dependencies"
import { createZipArchive } from "../../../test/create-zip-archive/index.ts"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"
import { extractDistPackage } from "../../build-artifacts/extract-dist-package/index.ts"
import { readBuildPreviewFile } from "../../build-preview/read-build-preview-file/index.ts"
import { distArtifactName, screenshotArtifactName } from "../constants.ts"
import type { GitHubWorkflowRunJob } from "../get-github-workflow-run-job-definition"
import { importGitHubWorkflowRun } from "./index.ts"

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const logger = { info() {}, warn() {} }

function distPackage(html = "<h1>Home</h1>") {
  return createZipArchive([
    { name: "dist/index.html", bytes: html },
    { name: "dist/assets/app.js", bytes: "console.log(1)" },
  ])
}

function screenshotPackage(distDigest: string) {
  return createZipArchive([
    { name: "screenshots.json", bytes: JSON.stringify({ version: 1, distDigest }) },
    { name: "screenshots/desktop.png", bytes: png },
  ])
}

/** Mirrors the write-once contract of the configured storage providers. */
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
    delete: () => Promise.reject(new Error("GitHub Build imports must not delete artifacts.")),
  }
}

async function createFixture() {
  const githubRepositoryId = randomInt(1, 2 ** 31)
  await prisma.repository.create({
    data: {
      githubRepositoryId,
      nameWithOwner: `octo/${randomUUID()}`,
      defaultBranch: "main",
    },
  })
  const storage = createImmutableStorage()

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
  const packages = new Map<string, Buffer>()
  const client = {
    getWorkflowRun: () => Promise.resolve({ ...run }),
    listRunArtifacts: (_runId: number, name: string) =>
      Promise.resolve<GitHubWorkflowArtifact[]>(
        packages.has(name)
          ? [{ id: name === distArtifactName ? 1 : 2, name, sizeInBytes: 1, expired: false }]
          : [],
      ),
    downloadArtifact: (id: number) => {
      const bytes = packages.get(id === 1 ? distArtifactName : screenshotArtifactName)
      return Promise.resolve(
        bytes ? { status: "ok" as const, bytes: Buffer.from(bytes) } : { status: "gone" as const },
      )
    },
  }
  function importRun(job = { githubRepositoryId, runId: run.id }) {
    return importGitHubWorkflowRun({ database: prisma, storage, client, logger }, job)
  }
  function findBuild() {
    return prisma.build.findFirstOrThrow({
      where: { prototype: { repository: { githubRepositoryId } } },
      include: { artifacts: { orderBy: { path: "asc" } }, prototype: true },
    })
  }
  return { run, packages, importRun, findBuild, storage }
}

describe("importGitHubWorkflowRun", () => {
  it("serves the dist preview after a completed job while the workflow is still running", async () => {
    const fixture = await createFixture()

    await expect(fixture.importRun()).resolves.toEqual({ dist: "pending", screenshots: "absent" })
    expect((await fixture.findBuild()).state).toBe("running")

    fixture.packages.set(distArtifactName, distPackage())
    const enqueued: GitHubWorkflowRunJob[] = []
    const webhooks = createGitHubWebhookRouteDependencies({
      installationId: "700",
      provider: { configurationDigest: "test-provider", revision: 1 },
      webhookSecret: "webhook-secret-for-tests",
      syncRepositories: () => Promise.resolve(),
      enqueueWorkflowRunImport: (job) => {
        enqueued.push(job)
        return Promise.resolve()
      },
    })
    const payload = {
      action: "completed",
      repository: { id: fixture.run.repositoryId },
      workflow_job: { run_id: fixture.run.id },
    }
    await expect(
      webhooks.handleEvent("workflow_job", payload, {
        id: randomUUID(),
        payloadDigest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      }),
    ).resolves.toBe(true)
    expect(enqueued).toEqual([
      { githubRepositoryId: fixture.run.repositoryId, runId: fixture.run.id },
    ])
    await expect(fixture.importRun(enqueued[0])).resolves.toEqual({
      dist: "imported",
      screenshots: "absent",
    })

    const build = await fixture.findBuild()
    expect(fixture.run.status).toBe("in_progress")
    expect(build).toMatchObject({
      state: "successful",
      number: 1,
      commitSha: "a".repeat(40),
      githubWorkflowRunId: BigInt(fixture.run.id),
      authorLogin: "octocat",
      distDigest: extractDistPackage(distPackage()).distDigest,
    })
    expect(build.prototype.currentBuildId).toBe(build.id)
    expect(build.artifacts.map((artifact) => artifact.path)).toEqual([
      "dist/assets/app.js",
      "dist/index.html",
    ])
    const preview = await readBuildPreviewFile(
      { acceptsHtml: true, buildId: build.id, requestPath: "/" },
      {
        storage: fixture.storage,
        findArtifact: (buildId, file) => findBuildArtifact(prisma, buildId, file),
      },
    )
    expect(preview.status).toBe("ok")
    if (preview.status === "ok") expect(Buffer.from(preview.bytes).toString()).toContain("Home")
  })

  it("attaches late screenshots only when they depict the imported dist", async () => {
    const fixture = await createFixture()
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const { distDigest } = extractDistPackage(distPackage())

    fixture.packages.set(screenshotArtifactName, screenshotPackage("sha256:" + "0".repeat(64)))
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "digest-mismatch",
    })

    fixture.packages.set(screenshotArtifactName, screenshotPackage(distDigest))
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "attached",
    })
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "attached",
    })

    const build = await fixture.findBuild()
    expect(build.state).toBe("successful")
    expect(build.artifacts.map((artifact) => artifact.path)).toEqual([
      "dist/assets/app.js",
      "dist/index.html",
      "screenshots/desktop.png",
    ])
  })

  it("keeps a successful Build unchanged when a re-run uploads a different dist", async () => {
    const fixture = await createFixture()
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const before = await fixture.findBuild()

    fixture.run.runAttempt = 2
    fixture.packages.set(distArtifactName, distPackage("<h1>Changed</h1>"))
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "unchanged" })

    const after = await fixture.findBuild()
    expect(after).toMatchObject({ state: "successful", distDigest: before.distDigest })
    expect(after.artifacts).toEqual(before.artifacts)
  })

  it("fails the Build when a completed run has no usable dist, then recovers on a re-run", async () => {
    const fixture = await createFixture()
    fixture.run.status = "completed"
    fixture.run.conclusion = "failure"
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "failed" })
    expect(await fixture.findBuild()).toMatchObject({
      state: "failed",
      failureSummary: "The GitHub Actions workflow run ended with failure.",
    })

    fixture.run.runAttempt = 2
    fixture.run.conclusion = "success"
    fixture.packages.set(distArtifactName, createZipArchive([{ name: "dist/app.js" }]))
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "failed" })
    expect((await fixture.findBuild()).artifacts).toEqual([])

    fixture.run.runAttempt = 3
    fixture.packages.set(distArtifactName, distPackage())
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "imported" })
    expect(await fixture.findBuild()).toMatchObject({
      state: "successful",
      number: 1,
      failureSummary: null,
    })
  })

  it("ignores runs that are not Replica push workflows", async () => {
    const fixture = await createFixture()
    fixture.run.path = ".github/workflows/ci.yml"
    await expect(fixture.importRun()).resolves.toEqual({ dist: "ignored", screenshots: "absent" })
    await expect(
      prisma.prototype.count({
        where: {
          branchName: "prototype/welcome",
          repository: { githubRepositoryId: fixture.run.repositoryId },
        },
      }),
    ).resolves.toBe(0)
  })

  it("does not move the current Build back for a late older run", async () => {
    const fixture = await createFixture()
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const newer = await fixture.findBuild()

    fixture.run.id += 1
    fixture.run.headSha = "b".repeat(40)
    fixture.run.createdAt = new Date("2025-12-31T00:00:00Z")
    await fixture.importRun()

    const prototype = await prisma.prototype.findUniqueOrThrow({
      where: { id: newer.prototypeId },
      include: { builds: { orderBy: { number: "asc" } } },
    })
    expect(prototype.currentBuildId).toBe(newer.id)
    expect(prototype.builds.map((build) => build.number)).toEqual([1, 2])
  })
})
