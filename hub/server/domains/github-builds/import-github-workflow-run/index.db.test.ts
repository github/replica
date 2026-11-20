import { createHash, randomInt, randomUUID } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { GitHubCommitLookupError } from "../../../integrations/github/errors"
import type {
  GitHubWorkflowArtifact,
  GitHubWorkflowRun,
} from "../../../integrations/github/create-github-actions-client/types"
import { findBuildArtifact } from "../../../repositories/build-artifacts/find-build-artifact"
import { listGitHubBuildsAwaitingImport } from "../../../repositories/github-builds/list-github-builds-awaiting-import"
import { recordGitHubBuildAuthor } from "../../../repositories/github-builds/record-github-build-author"
import { createGitHubWebhookRouteDependencies } from "../../../routes/api/github/webhooks/create-github-webhook-route-dependencies"
import { createZipArchive } from "../../../test/create-zip-archive"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types"
import { extractDistPackage } from "../../build-artifacts/extract-dist-package"
import { readBuildPreviewFile } from "../../build-preview/read-build-preview-file"
import { distArtifactName, screenshotArtifactName } from "../constants"
import { discoverGitHubWorkflowRuns } from "../discover-github-workflow-runs"
import type { GitHubWorkflowRunJob } from "../get-github-workflow-run-job-definition"
import { refreshGitHubBranchHeads } from "../refresh-github-branch-heads"
import { importGitHubWorkflowRun } from "."

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
  const workflowPaths = [".github/workflows/replica.yml"]
  const hooks: { beforeDownload?: (id: number) => Promise<void> } = {}
  const client = {
    getBuildWorkflowPaths: () => Promise.resolve([...workflowPaths]),
    getWorkflowRun: (): Promise<GitHubWorkflowRun | null> => Promise.resolve({ ...run }),
    getCommitAuthor: vi
      .fn<
        (
          commitSha: string,
        ) => Promise<{ providerUserId: string; login: string; avatarUrl: string | null } | null>
      >()
      .mockResolvedValue(null),
    listRunArtifacts: (_runId: number, name: string) =>
      Promise.resolve<GitHubWorkflowArtifact[]>(
        packages.has(name)
          ? [
              {
                id: name === distArtifactName ? 1 : 2,
                name,
                sizeInBytes: 1,
                expired: false,
                createdAt: run.startedAt ?? undefined,
              },
            ]
          : [],
      ),
    downloadArtifact: async (id: number) => {
      await hooks.beforeDownload?.(id)
      const bytes = packages.get(id === 1 ? distArtifactName : screenshotArtifactName)
      return bytes
        ? { status: "ok" as const, bytes: Buffer.from(bytes) }
        : { status: "gone" as const }
    },
  }
  function importRun(job = { githubRepositoryId, runId: run.id }) {
    return importGitHubWorkflowRun({ database: prisma, storage, client, logger }, job)
  }
  function findBuild(buildId?: string) {
    return prisma.build.findFirstOrThrow({
      where: { id: buildId, prototype: { repository: { githubRepositoryId } } },
      include: { artifacts: { orderBy: { path: "asc" } }, prototype: true },
    })
  }
  function findAnalyticsEvents() {
    return prisma.analyticsEvent.findMany({
      where: { repository: { githubRepositoryId } },
      select: { eventName: true, prototypeId: true, buildId: true },
      orderBy: { id: "asc" },
    })
  }
  return {
    run,
    packages,
    hooks,
    importRun,
    findBuild,
    findAnalyticsEvents,
    storage,
    client,
    workflowPaths,
  }
}

describe("importGitHubWorkflowRun", () => {
  it("imports a selected custom caller from its webhook without letting a competing selected workflow replace its dist", async () => {
    const fixture = await createFixture()
    fixture.workflowPaths.splice(
      0,
      1,
      ".github/workflows/publish-proto.yml",
      ".github/workflows/preview.yaml",
    )
    fixture.run.path = ".github/workflows/publish-proto.yml@refs/heads/proto/custom"
    fixture.run.headBranch = "proto/custom"
    const originalDist = distPackage("<h1>Selected caller</h1>")
    const originalDigest = extractDistPackage(originalDist).distDigest
    fixture.packages.set(distArtifactName, originalDist)
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
      action: "in_progress",
      repository: { id: fixture.run.repositoryId },
      workflow_run: { id: fixture.run.id, path: fixture.run.path },
    }

    await expect(
      webhooks.handleEvent("workflow_run", payload, {
        id: randomUUID(),
        payloadDigest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      }),
    ).resolves.toBe(true)
    expect(enqueued).toHaveLength(1)
    await expect(fixture.importRun(enqueued[0])).resolves.toEqual({
      dist: "imported",
      screenshots: "absent",
    })
    const original = await fixture.findBuild()
    expect(original.prototype.registeredAt).toBeInstanceOf(Date)

    fixture.run.id += 1
    fixture.run.path = ".github/workflows/preview.yaml"
    fixture.run.createdAt = new Date("2026-01-01T00:02:00Z")
    const competingDist = distPackage("<h1>Competing caller</h1>")
    fixture.packages.set(distArtifactName, competingDist)
    fixture.packages.set(
      screenshotArtifactName,
      screenshotPackage(extractDistPackage(competingDist).distDigest),
    )

    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "digest-mismatch",
    })
    expect(await fixture.findBuild()).toMatchObject({
      id: original.id,
      githubWorkflowRunId: original.githubWorkflowRunId,
      distDigest: originalDigest,
      artifacts: original.artifacts,
      state: "successful",
    })
    const preview = await readBuildPreviewFile(
      { acceptsHtml: true, buildId: original.id, requestPath: "/" },
      {
        storage: fixture.storage,
        findArtifact: (buildId, file) => findBuildArtifact(prisma, buildId, file),
      },
    )
    expect(preview.status).toBe("ok")
    if (preview.status === "ok") {
      expect(Buffer.from(preview.bytes).toString()).toContain("<h1>Selected caller</h1>")
      expect(Buffer.from(preview.bytes).toString()).not.toContain("Competing caller")
    }

    fixture.packages.set(screenshotArtifactName, screenshotPackage(originalDigest))
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "attached",
    })
    expect((await fixture.findBuild()).artifacts.map((artifact) => artifact.path)).toContain(
      "screenshots/desktop.png",
    )
  })

  it("does not fetch workflow configuration or runs for a disconnected repository", async () => {
    const fixture = await createFixture()
    await prisma.repository.update({
      where: { githubRepositoryId: fixture.run.repositoryId },
      data: { removedAt: new Date() },
    })
    const selection = vi.spyOn(fixture.client, "getBuildWorkflowPaths")
    const getRun = vi.spyOn(fixture.client, "getWorkflowRun")

    await expect(fixture.importRun()).resolves.toEqual({ dist: "ignored", screenshots: "absent" })
    expect(selection).not.toHaveBeenCalled()
    expect(getRun).not.toHaveBeenCalled()
  })

  it("propagates configuration failures for an eligible run without preparing a Build", async () => {
    const fixture = await createFixture()
    vi.spyOn(fixture.client, "getBuildWorkflowPaths").mockRejectedValue(
      new Error(".github/replica.json builds.workflows is invalid."),
    )
    const getRun = vi.spyOn(fixture.client, "getWorkflowRun")

    await expect(fixture.importRun()).rejects.toThrow("builds.workflows")
    expect(getRun).toHaveBeenCalledWith(fixture.run.id)
    expect(await prisma.build.count()).toBe(0)
  })

  it.each([
    { event: "pull_request" },
    { event: "workflow_dispatch" },
    { event: "workflow_run" },
    { headBranch: null },
    { headBranch: "replica/install-workflow" },
    { repositoryId: 0 },
    { headSha: "not-an-immutable-commit" },
    { htmlUrl: "http://github.com/octo/proto/actions/runs/1" },
  ])("ignores an ineligible run before reading invalid configuration: %j", async (changes) => {
    const fixture = await createFixture()
    fixture.workflowPaths.splice(0, 1, ".github/workflows/publish-proto.yml")
    Object.assign(fixture.run, { path: ".github/workflows/publish-proto.yml" }, changes)
    const selection = vi
      .spyOn(fixture.client, "getBuildWorkflowPaths")
      .mockRejectedValue(new Error(".github/replica.json builds.workflows is invalid."))

    await expect(fixture.importRun()).resolves.toEqual({ dist: "ignored", screenshots: "absent" })
    expect(selection).not.toHaveBeenCalled()
    expect(await prisma.build.count()).toBe(0)
  })

  it("ignores a missing run before reading invalid configuration", async () => {
    const fixture = await createFixture()
    vi.spyOn(fixture.client, "getWorkflowRun").mockResolvedValue(null)
    const selection = vi
      .spyOn(fixture.client, "getBuildWorkflowPaths")
      .mockRejectedValue(new Error(".github/replica.json builds.workflows is invalid."))

    await expect(fixture.importRun()).resolves.toEqual({ dist: "ignored", screenshots: "absent" })
    expect(selection).not.toHaveBeenCalled()
    expect(await prisma.build.count()).toBe(0)
  })

  it("serves the dist preview after a completed job while the workflow is still running", async () => {
    const fixture = await createFixture()
    fixture.run.headBranch = "proto/welcome/nested"

    await expect(fixture.importRun()).resolves.toEqual({ dist: "pending", screenshots: "absent" })
    expect(await fixture.findBuild()).toMatchObject({
      state: "running",
      prototype: { registeredAt: null },
    })

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
      distDigest: extractDistPackage(distPackage()).distDigest,
    })
    expect(build.prototype.currentBuildId).toBe(build.id)
    expect(build.prototype.name).toBe("proto/welcome/nested")
    expect(build.prototype.registeredAt).toBeInstanceOf(Date)
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

  it("keeps a run queued until GitHub reports it in progress", async () => {
    const fixture = await createFixture()
    fixture.run.status = "queued"

    await fixture.importRun()
    expect(await fixture.findBuild()).toMatchObject({ state: "queued", startedAt: null })

    fixture.run.status = "in_progress"
    await fixture.importRun()
    expect(await fixture.findBuild()).toMatchObject({ state: "running" })
  })

  it("does not save the run actor as the commit author", async () => {
    const fixture = await createFixture()

    await fixture.importRun()

    expect(await fixture.findBuild()).toMatchObject({
      authorProvider: null,
      authorIssuer: null,
      authorProviderUserId: null,
      authorLogin: null,
      authorName: null,
      authorAvatarUrl: null,
      prototype: { authorId: null },
    })
    expect(await prisma.user.count()).toBe(0)
    expect(fixture.client.getCommitAuthor).toHaveBeenCalledWith(fixture.run.headSha)
  })

  it("records the GitHub commit author without assigning the mapped user as prototype owner", async () => {
    const fixture = await createFixture()
    const author = await prisma.user.create({
      data: {
        externalIdentities: {
          create: { provider: "github", issuer: "https://github.com", subject: "101" },
        },
      },
      include: { profile: true },
    })
    await prisma.user.create({
      data: {
        externalIdentities: {
          create: { provider: "github", issuer: "https://github.com", subject: "9" },
        },
      },
    })
    fixture.client.getCommitAuthor.mockResolvedValue({
      providerUserId: "101",
      login: "commit-author",
      avatarUrl: "https://avatars.githubusercontent.com/u/101",
    })

    await fixture.importRun()

    expect(author.profile).toBeNull()
    expect(fixture.client.getCommitAuthor).toHaveBeenCalledWith(fixture.run.headSha)
    expect(await fixture.findBuild()).toMatchObject({
      commitSha: fixture.run.headSha,
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: "101",
      authorLogin: "commit-author",
      authorName: null,
      authorAvatarUrl: "https://avatars.githubusercontent.com/u/101",
      prototype: { authorId: null },
    })
    expect(await prisma.user.count()).toBe(2)
    expect(await prisma.externalIdentity.count()).toBe(2)
  })

  it("keeps an unmapped author's provider snapshot without creating a Hub identity", async () => {
    const fixture = await createFixture()
    const unrelated = await prisma.user.create({
      data: {
        externalIdentities: {
          create: [
            { provider: "github", issuer: "https://github.example.test", subject: "101" },
            { provider: "entra", issuer: "https://github.com", subject: "101" },
          ],
        },
      },
    })
    fixture.client.getCommitAuthor.mockResolvedValue({
      providerUserId: "101",
      login: "unmapped-author",
      avatarUrl: null,
    })

    await fixture.importRun()

    expect(await fixture.findBuild()).toMatchObject({
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: "101",
      authorLogin: "unmapped-author",
      authorAvatarUrl: null,
      prototype: { authorId: null },
    })
    expect(await prisma.user.findMany({ select: { id: true } })).toEqual([{ id: unrelated.id }])
    expect(await prisma.externalIdentity.count()).toBe(2)
  })

  it("preserves a legacy author snapshot instead of mixing in a different identity on import", async () => {
    const fixture = await createFixture()
    await fixture.importRun()
    const build = await fixture.findBuild()
    const snapshot = {
      authorLogin: "legacy-author",
      authorName: "Legacy author",
      authorAvatarUrl: "https://example.test/legacy.png",
    }
    await prisma.build.update({ where: { id: build.id }, data: snapshot })
    await prisma.user.create({
      data: {
        externalIdentities: {
          create: { provider: "github", issuer: "https://github.com", subject: "101" },
        },
      },
    })
    fixture.client.getCommitAuthor.mockClear().mockResolvedValue({
      providerUserId: "101",
      login: "different-author",
      avatarUrl: "https://example.test/different.png",
    })

    await fixture.importRun()

    expect(fixture.client.getCommitAuthor).toHaveBeenCalledWith(fixture.run.headSha)
    expect(await fixture.findBuild()).toMatchObject({
      authorProvider: null,
      authorIssuer: null,
      authorProviderUserId: null,
      ...snapshot,
      prototype: { authorId: null },
    })
    expect(await prisma.user.count()).toBe(1)
  })

  it("preserves an explicit prototype owner while recording a different commit author", async () => {
    const fixture = await createFixture()
    await fixture.importRun()
    const original = await fixture.findBuild()
    const owner = await prisma.user.create({ data: {} })
    await prisma.prototype.update({
      where: { id: original.prototypeId },
      data: { authorId: owner.id },
    })
    await prisma.user.create({
      data: {
        externalIdentities: {
          create: { provider: "github", issuer: "https://github.com", subject: "101" },
        },
      },
    })
    fixture.run.headSha = "b".repeat(40)
    fixture.run.id += 1
    fixture.run.createdAt = new Date("2026-01-01T00:02:00Z")
    fixture.client.getCommitAuthor.mockResolvedValue({
      providerUserId: "101",
      login: "different-author",
      avatarUrl: null,
    })

    await fixture.importRun()

    const build = await prisma.build.findUniqueOrThrow({
      where: {
        prototypeId_commitSha: {
          prototypeId: original.prototypeId,
          commitSha: fixture.run.headSha,
        },
      },
      include: { prototype: true },
    })
    expect(build).toMatchObject({
      authorProviderUserId: "101",
      authorLogin: "different-author",
      prototype: { authorId: owner.id },
    })
  })

  it("retries a failed author lookup instead of completing the import with unknown attribution", async () => {
    const fixture = await createFixture()
    fixture.packages.set(distArtifactName, distPackage())
    fixture.client.getCommitAuthor
      .mockRejectedValueOnce(new Error("Commit lookup unavailable"))
      .mockResolvedValue({
        providerUserId: "101",
        login: "commit-author",
        avatarUrl: null,
      })

    await expect(fixture.importRun()).rejects.toThrow("Commit lookup unavailable")
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "imported" })

    expect(await fixture.findBuild()).toMatchObject({
      state: "successful",
      authorProviderUserId: "101",
      authorLogin: "commit-author",
    })
    expect(await prisma.build.count()).toBe(1)
  })

  it("imports available artifacts while a failed author lookup remains observable and retryable", async () => {
    const fixture = await createFixture()
    fixture.run.headBranch = "proto/welcome"
    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    const warn = vi.spyOn(logger, "warn")
    const dist = distPackage()
    fixture.packages.set(distArtifactName, dist)
    fixture.packages.set(
      screenshotArtifactName,
      screenshotPackage(extractDistPackage(dist).distDigest),
    )
    fixture.client.getCommitAuthor
      .mockRejectedValueOnce(new GitHubCommitLookupError(422))
      .mockResolvedValue({ providerUserId: "101", login: "commit-author", avatarUrl: null })

    await expect(fixture.importRun()).rejects.toThrow("GitHub commit lookup failed (HTTP 422).")
    const imported = await fixture.findBuild()
    expect(imported).toMatchObject({
      state: "successful",
      authorProviderUserId: null,
      workflowCompletedAt: null,
      prototype: { authorId: null },
    })
    expect(imported.prototype.registeredAt).toBeInstanceOf(Date)
    expect(imported.artifacts.map((artifact) => artifact.path)).toEqual([
      "dist/assets/app.js",
      "dist/index.html",
      "screenshots/desktop.png",
    ])
    expect(warn).toHaveBeenCalledWith(
      {
        buildId: imported.id,
        runId: fixture.run.id,
        errorType: "GitHubCommitLookupError",
        statusCode: 422,
      },
      "GitHub commit author lookup failed; artifact import will continue and retry",
    )
    const retry = { githubRepositoryId: fixture.run.repositoryId, runId: fixture.run.id }
    expect(
      await listGitHubBuildsAwaitingImport(prisma, { createdAfter: new Date(0) }),
    ).toContainEqual(retry)

    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "attached",
    })
    const repaired = await fixture.findBuild()
    expect(repaired).toMatchObject({
      id: imported.id,
      authorProviderUserId: "101",
      workflowCompletedAt: fixture.run.updatedAt,
    })
    expect(repaired.artifacts).toEqual(imported.artifacts)
    expect(
      await listGitHubBuildsAwaitingImport(prisma, { createdAfter: new Date(0) }),
    ).not.toContainEqual(retry)
  })

  it.each([
    {
      dist: "missing",
      failureSummary: `GitHub Actions did not provide the ${distArtifactName} artifact.`,
    },
    { dist: "invalid", failureSummary: "The package does not contain dist/index.html." },
  ])(
    "recovers author resolution for a failed Build with $dist dist without reopening it",
    async ({ dist, failureSummary }) => {
      const fixture = await createFixture()
      fixture.run.headBranch = "proto/recover-author"
      fixture.run.status = "completed"
      fixture.run.conclusion = "success"
      if (dist === "invalid") {
        fixture.packages.set(distArtifactName, createZipArchive([{ name: "dist/app.js" }]))
      }
      const owner = await prisma.user.create({
        data: {
          externalIdentities: {
            create: { provider: "github", issuer: "https://github.com", subject: "101" },
          },
        },
      })
      const author = {
        providerUserId: "101",
        login: "commit-author",
        avatarUrl: "https://example.test/author.png",
      }
      fixture.client.getCommitAuthor
        .mockRejectedValueOnce(new GitHubCommitLookupError(503))
        .mockRejectedValueOnce(new GitHubCommitLookupError(503))
        .mockResolvedValue(author)
      const job = { githubRepositoryId: fixture.run.repositoryId, runId: fixture.run.id }
      const createdAfter = new Date(0)
      async function recovery() {
        return {
          awaiting: await listGitHubBuildsAwaitingImport(prisma, { createdAfter }),
          discovered: await discoverGitHubWorkflowRuns(
            {
              database: prisma,
              listWorkflowRuns: (repositoryId, since) =>
                Promise.resolve(
                  repositoryId === fixture.run.repositoryId &&
                    fixture.run.createdAt >= since &&
                    fixture.workflowPaths.includes(fixture.run.path)
                    ? [fixture.run]
                    : [],
                ),
              listBranchHeads: () => Promise.resolve([]),
              isAncestor: () => Promise.resolve(false),
              logger,
            },
            { createdAfter },
          ),
        }
      }

      await expect(fixture.importRun()).rejects.toThrow("GitHub commit lookup failed (HTTP 503).")
      const imported = await fixture.findBuild()
      await prisma.prototype.update({
        where: { id: imported.prototypeId },
        data: { authorId: owner.id },
      })
      const failed = await fixture.findBuild()
      expect(failed).toMatchObject({
        state: "failed",
        failureSummary,
        authorProviderUserId: null,
        githubWorkflowRunId: BigInt(fixture.run.id),
        githubWorkflowRunAttempt: fixture.run.runAttempt,
        workflowCompletedAt: null,
        distDigest: null,
        artifacts: [],
        prototype: { authorId: owner.id, registeredAt: null },
      })
      expect(failed.startedAt).toBeInstanceOf(Date)
      expect(failed.finishedAt).toBeInstanceOf(Date)
      expect(await recovery()).toEqual({ awaiting: [], discovered: [job] })

      fixture.workflowPaths.splice(0, 1, ".github/workflows/other.yml")
      await expect(fixture.importRun()).resolves.toEqual({ dist: "ignored", screenshots: "absent" })
      expect(fixture.client.getCommitAuthor).toHaveBeenCalledTimes(1)
      expect(await fixture.findBuild()).toMatchObject({
        state: "failed",
        failureSummary,
        authorProviderUserId: null,
        startedAt: failed.startedAt,
        finishedAt: failed.finishedAt,
      })
      expect(await recovery()).toEqual({ awaiting: [], discovered: [] })
      fixture.workflowPaths.splice(0, 1, ".github/workflows/replica.yml")
      expect(await recovery()).toEqual({ awaiting: [], discovered: [job] })

      fixture.packages.set(distArtifactName, distPackage("<h1>Late dist</h1>"))
      await expect(fixture.importRun()).rejects.toThrow("GitHub commit lookup failed (HTTP 503).")
      expect(await fixture.findBuild()).toMatchObject({
        id: failed.id,
        state: "failed",
        failureSummary,
        startedAt: failed.startedAt,
        finishedAt: failed.finishedAt,
        githubWorkflowRunId: failed.githubWorkflowRunId,
        githubWorkflowRunAttempt: failed.githubWorkflowRunAttempt,
        distDigest: null,
        artifacts: [],
      })
      expect(await recovery()).toEqual({ awaiting: [], discovered: [job] })

      await expect(fixture.importRun()).resolves.toMatchObject({ dist: "unchanged" })
      expect(await fixture.findBuild()).toMatchObject({
        id: failed.id,
        state: "failed",
        failureSummary,
        startedAt: failed.startedAt,
        finishedAt: failed.finishedAt,
        githubWorkflowRunId: failed.githubWorkflowRunId,
        githubWorkflowRunAttempt: failed.githubWorkflowRunAttempt,
        workflowCompletedAt: fixture.run.updatedAt,
        distDigest: null,
        artifacts: [],
        authorProvider: "github",
        authorIssuer: "https://github.com",
        authorProviderUserId: author.providerUserId,
        authorLogin: author.login,
        authorAvatarUrl: author.avatarUrl,
        prototype: { authorId: owner.id, registeredAt: null, currentBuildId: failed.id },
      })
      expect(fixture.client.getCommitAuthor).toHaveBeenCalledTimes(3)
      expect(await fixture.findAnalyticsEvents()).toEqual([])
      expect(await recovery()).toEqual({ awaiting: [], discovered: [] })
    },
  )

  it("does not let a delayed failed-run author lookup overwrite a newer successful attempt", async () => {
    const fixture = await createFixture()
    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    const author = { providerUserId: "101", login: "commit-author", avatarUrl: null }
    fixture.client.getCommitAuthor.mockRejectedValueOnce(new GitHubCommitLookupError(503))
    await expect(fixture.importRun()).rejects.toThrow("GitHub commit lookup failed (HTTP 503).")
    const failed = await fixture.findBuild()

    let newer: Awaited<ReturnType<typeof fixture.findBuild>> | undefined
    fixture.client.getCommitAuthor
      .mockImplementationOnce(async () => {
        fixture.run.runAttempt = 2
        fixture.run.updatedAt = new Date("2026-01-01T00:05:00Z")
        fixture.packages.set(distArtifactName, distPackage("<h1>New attempt</h1>"))
        await fixture.importRun()
        newer = await fixture.findBuild()
        return author
      })
      .mockResolvedValue(author)

    await fixture.importRun()

    expect(newer).toMatchObject({
      id: failed.id,
      state: "successful",
      githubWorkflowRunAttempt: 2,
      workflowCompletedAt: fixture.run.updatedAt,
      authorProviderUserId: author.providerUserId,
    })
    expect(newer?.artifacts.length).toBeGreaterThan(0)
    expect(await fixture.findBuild()).toEqual(newer)
  })

  it("finishes late screenshots without looking up an already saved GitHub identity", async () => {
    const fixture = await createFixture()
    fixture.packages.set(distArtifactName, distPackage())
    fixture.client.getCommitAuthor.mockResolvedValue({
      providerUserId: "101",
      login: "commit-author",
      avatarUrl: "https://example.test/author.png",
    })
    await fixture.importRun()
    const before = await fixture.findBuild()
    expect(before).toMatchObject({
      state: "successful",
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: "101",
      authorLogin: "commit-author",
      prototype: { authorId: null },
    })
    await prisma.user.create({
      data: {
        externalIdentities: {
          create: { provider: "github", issuer: "https://github.com", subject: "101" },
        },
      },
    })

    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    fixture.run.updatedAt = new Date("2026-01-01T00:05:00Z")
    fixture.packages.set(screenshotArtifactName, screenshotPackage(before.distDigest!))
    fixture.client.getCommitAuthor
      .mockClear()
      .mockRejectedValue(new Error("Commit lookup unavailable"))

    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "attached",
    })

    expect(fixture.client.getCommitAuthor).not.toHaveBeenCalled()
    const after = await fixture.findBuild()
    expect(after).toMatchObject({
      id: before.id,
      authorProvider: before.authorProvider,
      authorIssuer: before.authorIssuer,
      authorProviderUserId: before.authorProviderUserId,
      authorLogin: before.authorLogin,
      authorAvatarUrl: before.authorAvatarUrl,
      workflowCompletedAt: fixture.run.updatedAt,
      prototype: { authorId: null },
    })
    expect(after.artifacts.map((artifact) => artifact.path)).toContain("screenshots/desktop.png")
    expect(await prisma.user.count()).toBe(1)
  })

  it("retries missing author identity without assigning the mapped user as prototype owner", async () => {
    const fixture = await createFixture()
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const before = await fixture.findBuild()
    expect(before).toMatchObject({
      state: "successful",
      authorProviderUserId: null,
      prototype: { authorId: null },
    })
    expect(await prisma.user.count()).toBe(0)

    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    fixture.run.updatedAt = new Date("2026-01-01T00:05:00Z")
    fixture.packages.set(screenshotArtifactName, screenshotPackage(before.distDigest!))
    fixture.client.getCommitAuthor
      .mockClear()
      .mockRejectedValueOnce(new Error("Commit lookup unavailable"))

    await expect(fixture.importRun()).rejects.toThrow("Commit lookup unavailable")
    expect(fixture.client.getCommitAuthor).toHaveBeenCalledWith(fixture.run.headSha)
    expect(await fixture.findBuild()).toMatchObject({
      authorProviderUserId: null,
      workflowCompletedAt: null,
      prototype: { authorId: null },
    })
    expect(await prisma.user.count()).toBe(0)

    await prisma.user.create({
      data: {
        externalIdentities: {
          create: { provider: "github", issuer: "https://github.com", subject: "101" },
        },
      },
    })
    fixture.client.getCommitAuthor.mockClear().mockResolvedValue({
      providerUserId: "101",
      login: "commit-author",
      avatarUrl: null,
    })

    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "attached",
    })
    expect(fixture.client.getCommitAuthor).toHaveBeenCalledWith(fixture.run.headSha)
    expect(await fixture.findBuild()).toMatchObject({
      id: before.id,
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: "101",
      authorLogin: "commit-author",
      workflowCompletedAt: fixture.run.updatedAt,
      prototype: { authorId: null },
    })
    expect(await prisma.user.count()).toBe(1)
  })

  it("attaches late screenshots only when they depict the imported dist", async () => {
    const fixture = await createFixture()
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const { distDigest } = extractDistPackage(distPackage())
    const write = vi.spyOn(fixture.storage, "write")

    fixture.packages.set(screenshotArtifactName, screenshotPackage("sha256:" + "0".repeat(64)))
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "digest-mismatch",
    })
    expect(write).not.toHaveBeenCalled()
    expect((await fixture.findBuild()).artifacts.map((artifact) => artifact.path)).toEqual([
      "dist/assets/app.js",
      "dist/index.html",
    ])

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
    expect(build.prototype.registeredAt).toBeNull()
    expect(build.artifacts.map((artifact) => artifact.path)).toEqual([
      "dist/assets/app.js",
      "dist/index.html",
      "screenshots/desktop.png",
    ])
  })

  it("marks a run complete only after its final screenshot pass", async () => {
    const fixture = await createFixture()
    fixture.run.headBranch = "proto/completed"
    fixture.packages.set(distArtifactName, distPackage())
    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    fixture.run.updatedAt = new Date("2026-01-01T00:05:00Z")
    fixture.packages.set(
      screenshotArtifactName,
      screenshotPackage(extractDistPackage(distPackage()).distDigest),
    )
    fixture.hooks.beforeDownload = async (id) => {
      if (id !== 2) return
      const build = await fixture.findBuild()
      expect(build).toMatchObject({
        state: "successful",
        workflowCompletedAt: null,
      })
      expect(build.prototype.registeredAt).toBeInstanceOf(Date)
      throw new Error("GitHub is unavailable")
    }
    await expect(fixture.importRun()).rejects.toThrow("GitHub is unavailable")
    const build = await fixture.findBuild()
    expect(build.workflowCompletedAt).toBeNull()
    const events = await fixture.findAnalyticsEvents()
    expect(events).toHaveLength(2)
    expect(events).toContainEqual({
      eventName: "prototype_first_published",
      prototypeId: build.prototypeId,
      buildId: build.id,
    })
    expect(events).toContainEqual({
      eventName: "prototype_registered",
      prototypeId: build.prototypeId,
      buildId: null,
    })

    const jobs = await discoverGitHubWorkflowRuns(
      {
        database: prisma,
        listWorkflowRuns: () => Promise.resolve([fixture.run]),
        listBranchHeads: () => Promise.resolve([]),
        isAncestor: () => Promise.resolve(false),
        logger,
      },
      { createdAfter: new Date("2025-12-31T00:00:00Z") },
    )
    expect(jobs).toContainEqual({
      githubRepositoryId: fixture.run.repositoryId,
      runId: fixture.run.id,
    })

    fixture.hooks.beforeDownload = undefined
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "attached",
    })
    expect((await fixture.findBuild()).workflowCompletedAt).toEqual(fixture.run.updatedAt)
    await expect(fixture.findAnalyticsEvents()).resolves.toEqual(events)
  })

  it("recovers another selected caller's screenshots until that run attempt finishes processing", async () => {
    const fixture = await createFixture()
    fixture.workflowPaths.push(".github/workflows/preview.yaml")
    fixture.run.id = 100
    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const owner = await fixture.findBuild()
    expect(owner.workflowCompletedAt).toEqual(fixture.run.updatedAt)

    fixture.run.id = 101
    fixture.run.path = ".github/workflows/preview.yaml"
    fixture.run.createdAt = new Date("2026-01-01T00:02:00Z")
    fixture.run.updatedAt = new Date("2026-01-01T00:03:00Z")
    fixture.run.status = "in_progress"
    fixture.run.conclusion = null
    fixture.packages.set(distArtifactName, distPackage("<h1>Another caller's dist</h1>"))
    const job = { githubRepositoryId: fixture.run.repositoryId, runId: fixture.run.id }
    function poll() {
      return discoverGitHubWorkflowRuns(
        {
          database: prisma,
          listWorkflowRuns: () => Promise.resolve([fixture.run]),
          listBranchHeads: () => Promise.resolve([]),
          isAncestor: () => Promise.resolve(false),
          logger,
        },
        { createdAfter: new Date("2025-12-31T00:00:00Z") },
      )
    }

    await expect(poll()).resolves.toEqual([job])
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "absent",
    })
    await expect(poll()).resolves.toEqual([job])

    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    fixture.run.updatedAt = new Date("2026-01-01T00:05:00Z")
    fixture.packages.set(screenshotArtifactName, screenshotPackage(owner.distDigest!))
    fixture.hooks.beforeDownload = () => Promise.reject(new Error("Screenshots unavailable"))
    await expect(fixture.importRun()).rejects.toThrow("Screenshots unavailable")
    await expect(poll()).resolves.toEqual([job])

    fixture.hooks.beforeDownload = undefined
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "attached",
    })
    await expect(poll()).resolves.toEqual([])
    const completed = await fixture.findBuild()
    expect(completed.artifacts.map((artifact) => artifact.path)).toContain(
      "screenshots/desktop.png",
    )

    fixture.run.runAttempt = 2
    fixture.run.status = "in_progress"
    fixture.run.conclusion = null
    fixture.packages.delete(screenshotArtifactName)
    await expect(poll()).resolves.toEqual([job])
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "absent",
    })
    await expect(poll()).resolves.toEqual([job])

    fixture.run.status = "completed"
    fixture.run.conclusion = "failure"
    fixture.run.updatedAt = new Date("2026-01-01T00:10:00Z")
    fixture.packages.set(screenshotArtifactName, screenshotPackage("sha256:" + "0".repeat(64)))
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "digest-mismatch",
    })
    await expect(poll()).resolves.toEqual([])
    expect(await fixture.findBuild()).toMatchObject({
      state: "successful",
      githubWorkflowRunId: owner.githubWorkflowRunId,
      githubWorkflowRunAttempt: owner.githubWorkflowRunAttempt,
      workflowCompletedAt: owner.workflowCompletedAt,
      distDigest: owner.distDigest,
      artifacts: completed.artifacts,
    })
  })

  it("retries a newer screenshot attempt without reopening or rewriting a successful dist", async () => {
    const fixture = await createFixture()
    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const before = await fixture.findBuild()
    expect(before.workflowCompletedAt).not.toBeNull()

    fixture.run.runAttempt = 2
    fixture.run.startedAt = new Date("2026-01-01T00:02:00Z")
    fixture.run.updatedAt = new Date("2026-01-01T00:05:00Z")
    fixture.packages.set(screenshotArtifactName, screenshotPackage(before.distDigest!))
    fixture.hooks.beforeDownload = () => Promise.reject(new Error("Screenshot download failed"))
    const write = vi.spyOn(fixture.storage, "write")

    await expect(fixture.importRun()).rejects.toThrow("Screenshot download failed")
    expect(await fixture.findBuild()).toMatchObject({
      state: "successful",
      githubWorkflowRunAttempt: 2,
      workflowCompletedAt: null,
      distDigest: before.distDigest,
      artifacts: before.artifacts,
    })
    expect(write).not.toHaveBeenCalled()

    fixture.hooks.beforeDownload = undefined
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "attached",
    })
    expect((await fixture.findBuild()).workflowCompletedAt).toEqual(fixture.run.updatedAt)
  })

  it("accepts retained screenshots from an earlier same-run attempt only for the immutable dist", async () => {
    const fixture = await createFixture()
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const before = await fixture.findBuild()
    fixture.run.runAttempt = 2
    fixture.run.startedAt = new Date("2026-01-01T00:02:00Z")
    fixture.packages.set(screenshotArtifactName, screenshotPackage("sha256:" + "0".repeat(64)))
    vi.spyOn(fixture.client, "listRunArtifacts").mockImplementation((_runId, name) =>
      Promise.resolve(
        name === screenshotArtifactName
          ? [
              {
                id: 2,
                name,
                expired: false,
                sizeInBytes: 1,
                createdAt: new Date("2026-01-01T00:01:00Z"),
              },
            ]
          : [],
      ),
    )
    const write = vi.spyOn(fixture.storage, "write")

    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "digest-mismatch",
    })
    expect(write).not.toHaveBeenCalled()
    fixture.packages.set(screenshotArtifactName, screenshotPackage(before.distDigest!))
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "attached",
    })
    const after = await fixture.findBuild()
    expect(after.distDigest).toBe(before.distDigest)
    expect(after.artifacts.filter((artifact) => artifact.kind === "dist")).toEqual(before.artifacts)
  })

  it("keeps a successful Build unchanged when a re-run uploads a different dist", async () => {
    const fixture = await createFixture()
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const before = await fixture.findBuild()

    fixture.run.runAttempt = 2
    fixture.run.startedAt = new Date("2026-01-01T00:02:00Z")
    fixture.packages.set(distArtifactName, distPackage("<h1>Changed</h1>"))
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "unchanged" })

    const after = await fixture.findBuild()
    expect(after).toMatchObject({ state: "successful", distDigest: before.distDigest })
    expect(after.artifacts).toEqual(before.artifacts)
  })

  it("fails the Build when a completed run has no usable dist, then recovers on a re-run", async () => {
    const fixture = await createFixture()
    fixture.run.headBranch = "proto/recover"
    fixture.run.status = "completed"
    fixture.run.conclusion = "failure"
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "failed" })
    expect(await fixture.findBuild()).toMatchObject({
      state: "failed",
      failureSummary: "The GitHub Actions workflow run ended with failure.",
      prototype: { registeredAt: null },
    })
    await expect(fixture.findAnalyticsEvents()).resolves.toEqual([])

    fixture.run.runAttempt = 2
    fixture.run.startedAt = new Date("2026-01-01T00:02:00Z")
    fixture.run.conclusion = "success"
    fixture.packages.set(distArtifactName, createZipArchive([{ name: "dist/app.js" }]))
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "failed" })
    expect(await fixture.findBuild()).toMatchObject({
      artifacts: [],
      prototype: { registeredAt: null },
    })
    await expect(fixture.findAnalyticsEvents()).resolves.toEqual([])

    fixture.run.runAttempt = 3
    fixture.run.startedAt = new Date("2026-01-01T00:03:00Z")
    fixture.packages.set(distArtifactName, distPackage())
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "imported" })
    const build = await fixture.findBuild()
    expect(build).toMatchObject({
      state: "successful",
      number: 1,
      failureSummary: null,
    })
    expect(build.prototype.registeredAt).toBeInstanceOf(Date)
    expect(await fixture.findAnalyticsEvents()).toContainEqual({
      eventName: "prototype_first_published",
      prototypeId: build.prototypeId,
      buildId: build.id,
    })
  })

  it("recovers registration on repeated imports without rewriting a successful Build", async () => {
    const fixture = await createFixture()
    fixture.run.headBranch = "proto/recovered-registration"
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const before = await fixture.findBuild()
    await prisma.prototype.update({
      where: { id: before.prototypeId },
      data: { registeredAt: null, name: "Saved title", description: "Saved description" },
    })
    const write = vi.spyOn(fixture.storage, "write")

    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "absent",
    })
    const recovered = await fixture.findBuild()
    expect(recovered.prototype).toMatchObject({
      name: "Saved title",
      description: "Saved description",
    })
    expect(recovered.prototype.registeredAt).toBeInstanceOf(Date)
    expect(recovered.distDigest).toBe(before.distDigest)
    expect(recovered.artifacts).toEqual(before.artifacts)
    expect(write).not.toHaveBeenCalled()

    await fixture.importRun()
    expect((await fixture.findBuild()).prototype.registeredAt).toEqual(
      recovered.prototype.registeredAt,
    )
  })

  it("recovers registration when a concurrent importer completes the dist first", async () => {
    const fixture = await createFixture()
    fixture.run.headBranch = "proto/concurrent"
    await fixture.importRun()
    fixture.packages.set(distArtifactName, distPackage())
    fixture.hooks.beforeDownload = async () => {
      fixture.hooks.beforeDownload = undefined
      await fixture.importRun()
      const build = await fixture.findBuild()
      await prisma.prototype.update({
        where: { id: build.prototypeId },
        data: { registeredAt: null, name: "Saved title", description: "Saved description" },
      })
    }

    await expect(fixture.importRun()).resolves.toEqual({
      dist: "unchanged",
      screenshots: "absent",
    })
    const build = await fixture.findBuild()
    expect(build).toMatchObject({
      state: "successful",
      prototype: {
        name: "Saved title",
        description: "Saved description",
      },
    })
    expect(build.prototype.registeredAt).toBeInstanceOf(Date)
  })

  it("keeps the default branch owner marked as Replica even when its name starts with proto/", async () => {
    const fixture = await createFixture()
    fixture.run.headBranch = "proto/default"
    await prisma.repository.update({
      where: { githubRepositoryId: fixture.run.repositoryId },
      data: { defaultBranch: fixture.run.headBranch },
    })
    fixture.packages.set(distArtifactName, distPackage())

    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "imported" })

    expect(await fixture.findBuild()).toMatchObject({
      state: "successful",
      prototype: { replica: true, registeredAt: null },
    })
    await expect(fixture.findAnalyticsEvents()).resolves.toEqual([])
  })

  it.each(["delete", "push"])(
    "does not recreate a branch deleted by %s before its first import",
    async (event) => {
      const fixture = await createFixture()
      fixture.run.headBranch = "proto/deleted"
      const repository = await prisma.repository.findUniqueOrThrow({
        where: { githubRepositoryId: fixture.run.repositoryId },
      })
      const payload = {
        repository: { id: fixture.run.repositoryId },
        ...(event === "delete"
          ? { ref_type: "branch", ref: fixture.run.headBranch }
          : { deleted: true, ref: `refs/heads/${fixture.run.headBranch}` }),
      }
      const webhooks = createGitHubWebhookRouteDependencies({
        installationId: "700",
        provider: { configurationDigest: "test-provider", revision: 1 },
        webhookSecret: "webhook-secret-for-tests",
        syncRepositories: () => Promise.resolve(),
      })
      await expect(
        webhooks.handleEvent(event, payload, {
          id: randomUUID(),
          payloadDigest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
        }),
      ).resolves.toBe(true)
      const retired = await prisma.prototype.findFirstOrThrow({
        where: { repositoryId: repository.id, branchName: fixture.run.headBranch },
      })
      expect(retired.branchDeletedAt).toBeInstanceOf(Date)
      fixture.packages.set(distArtifactName, distPackage())
      const write = vi.spyOn(fixture.storage, "write")

      await expect(fixture.importRun()).resolves.toEqual({
        dist: "ignored",
        screenshots: "absent",
      })
      expect(await prisma.prototype.findMany({ where: { repositoryId: repository.id } })).toEqual([
        retired,
      ])
      expect(write).not.toHaveBeenCalled()
    },
  )

  it.each([false, true])(
    "imports retained dist after a missed import and a screenshots-only rerun completed=%s",
    async (completed) => {
      const fixture = await createFixture()
      fixture.run.runAttempt = 2
      const startedAt = new Date("2026-01-01T00:02:00Z")
      fixture.run.startedAt = startedAt
      fixture.run.status = completed ? "completed" : "in_progress"
      fixture.run.conclusion = completed ? "success" : null
      fixture.run.updatedAt = new Date("2026-01-01T00:05:00Z")
      const dist = distPackage()
      const screenshots = screenshotPackage(extractDistPackage(dist).distDigest)
      vi.spyOn(fixture.client, "listRunArtifacts").mockImplementation((_runId, name) =>
        Promise.resolve(
          name === distArtifactName
            ? [
                {
                  id: 999,
                  name,
                  sizeInBytes: 1,
                  expired: false,
                  createdAt: new Date("2026-01-01T00:01:00Z"),
                },
              ]
            : [
                {
                  id: 2,
                  name,
                  sizeInBytes: 1,
                  expired: false,
                  createdAt: startedAt,
                },
              ],
        ),
      )
      vi.spyOn(fixture.client, "downloadArtifact").mockImplementation((id) =>
        Promise.resolve({ status: "ok", bytes: Buffer.from(id === 999 ? dist : screenshots) }),
      )

      await expect(fixture.importRun()).resolves.toEqual({
        dist: "imported",
        screenshots: "attached",
      })
      expect(await fixture.findBuild()).toMatchObject({
        state: "successful",
        distDigest: extractDistPackage(dist).distDigest,
        workflowCompletedAt: completed ? fixture.run.updatedAt : null,
      })
    },
  )

  it("waits for a full rerun's own dist instead of importing an earlier attempt's", async () => {
    const fixture = await createFixture()
    fixture.run.runAttempt = 2
    const startedAt = new Date("2026-01-01T00:02:00Z")
    fixture.run.startedAt = startedAt
    const earlier = { id: 999, sizeInBytes: 1, expired: false, createdAt: new Date(0) }
    const current = distPackage("<h1>Current attempt</h1>")
    let currentUploaded = false
    vi.spyOn(fixture.client, "listRunArtifacts").mockImplementation((_runId, name) =>
      Promise.resolve(
        name !== distArtifactName
          ? []
          : [
              { ...earlier, name },
              ...(currentUploaded ? [{ ...earlier, id: 1, name, createdAt: startedAt }] : []),
            ],
      ),
    )
    vi.spyOn(fixture.client, "downloadArtifact").mockImplementation((id) =>
      Promise.resolve({
        status: "ok",
        bytes: Buffer.from(id === 1 ? current : distPackage("<h1>Earlier attempt</h1>")),
      }),
    )
    const write = vi.spyOn(fixture.storage, "write")

    await expect(fixture.importRun()).resolves.toEqual({ dist: "pending", screenshots: "absent" })
    expect(write).not.toHaveBeenCalled()
    currentUploaded = true
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "imported" })
    expect(await fixture.findBuild()).toMatchObject({
      state: "successful",
      distDigest: extractDistPackage(current).distDigest,
    })
  })

  it("fails without storing an earlier attempt's dist that this attempt's screenshots do not depict", async () => {
    const fixture = await createFixture()
    fixture.run.runAttempt = 2
    const startedAt = new Date("2026-01-01T00:02:00Z")
    fixture.run.startedAt = startedAt
    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    vi.spyOn(fixture.client, "listRunArtifacts").mockImplementation((_runId, name) =>
      Promise.resolve([
        {
          id: name === distArtifactName ? 999 : 2,
          name,
          sizeInBytes: 1,
          expired: false,
          createdAt: name === distArtifactName ? new Date(0) : startedAt,
        },
      ]),
    )
    vi.spyOn(fixture.client, "downloadArtifact").mockImplementation((id) =>
      Promise.resolve({
        status: "ok",
        bytes: Buffer.from(
          id === 999 ? distPackage() : screenshotPackage("sha256:" + "0".repeat(64)),
        ),
      }),
    )
    const write = vi.spyOn(fixture.storage, "write")

    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "failed" })
    expect(write).not.toHaveBeenCalled()
    expect(await fixture.findBuild()).toMatchObject({
      state: "failed",
      distDigest: null,
      artifacts: [],
      failureSummary: `The earlier ${distArtifactName} artifact does not match this attempt's screenshots.`,
    })
  })

  it("imports the current attempt's dist even when an older attempt's artifact has a higher ID", async () => {
    const fixture = await createFixture()
    fixture.run.runAttempt = 2
    const startedAt = new Date("2026-01-01T00:02:00Z")
    fixture.run.startedAt = startedAt
    const currentDist = distPackage("<h1>Current attempt</h1>")
    vi.spyOn(fixture.client, "listRunArtifacts").mockImplementation((_runId, name) =>
      Promise.resolve(
        name === distArtifactName
          ? [
              {
                id: 999,
                name,
                sizeInBytes: 1,
                expired: false,
                createdAt: new Date("2026-01-01T00:01:00Z"),
              },
              { id: 1, name, sizeInBytes: 1, expired: false, createdAt: startedAt },
            ]
          : [],
      ),
    )
    vi.spyOn(fixture.client, "downloadArtifact").mockImplementation((id) =>
      Promise.resolve({
        status: "ok",
        bytes: Buffer.from(id === 1 ? currentDist : distPackage("<h1>Earlier attempt</h1>")),
      }),
    )

    await expect(fixture.importRun()).resolves.toEqual({
      dist: "imported",
      screenshots: "absent",
    })
    expect(await fixture.findBuild()).toMatchObject({
      state: "successful",
      distDigest: extractDistPackage(currentDist).distDigest,
    })
  })

  it.each([".github/workflows/replica.yml", ".github/workflows/publish-proto.yml-extra"])(
    "queues but does not prepare an unrelated workflow path %s",
    async (path) => {
      const fixture = await createFixture()
      fixture.workflowPaths.splice(0, 1, ".github/workflows/publish-proto.yml")
      fixture.run.path = path
      const listArtifacts = vi.spyOn(fixture.client, "listRunArtifacts")
      const download = vi.spyOn(fixture.client, "downloadArtifact")
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
        workflow_run: { id: fixture.run.id, path: fixture.run.path },
      }

      await expect(
        webhooks.handleEvent("workflow_run", payload, {
          id: randomUUID(),
          payloadDigest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
        }),
      ).resolves.toBe(true)
      expect(enqueued).toEqual([
        { githubRepositoryId: fixture.run.repositoryId, runId: fixture.run.id },
      ])
      await expect(fixture.importRun(enqueued[0])).resolves.toEqual({
        dist: "ignored",
        screenshots: "absent",
      })
      await expect(
        prisma.prototype.count({
          where: {
            branchName: "prototype/welcome",
            repository: { githubRepositoryId: fixture.run.repositoryId },
          },
        }),
      ).resolves.toBe(0)
      expect(listArtifacts).not.toHaveBeenCalled()
      expect(download).not.toHaveBeenCalled()
    },
  )

  it.each([
    { initialStatus: "queued", observedStatus: "in_progress", observedAttempt: 2 },
    { initialStatus: "in_progress", observedStatus: "completed", observedAttempt: 1 },
  ])(
    "settles a deselected $initialStatus Build without importing artifacts and recovers only on a newer attempt",
    async ({ initialStatus, observedStatus, observedAttempt }) => {
      const fixture = await createFixture()
      fixture.run.status = initialStatus
      await fixture.importRun()
      const before = await fixture.findBuild()
      expect(before.state).toBe(initialStatus === "queued" ? "queued" : "running")
      const createdAfter = new Date(0)
      const job = { githubRepositoryId: fixture.run.repositoryId, runId: fixture.run.id }
      await expect(listGitHubBuildsAwaitingImport(prisma, { createdAfter })).resolves.toEqual([job])
      const observations = await prisma.branchHeadObservation.findMany()
      fixture.workflowPaths.splice(0)
      fixture.run.status = observedStatus
      fixture.run.runAttempt = observedAttempt
      fixture.run.updatedAt = new Date("2026-01-01T00:05:00Z")
      fixture.packages.set(distArtifactName, distPackage())
      fixture.client.getCommitAuthor.mockClear()
      const listArtifacts = vi.spyOn(fixture.client, "listRunArtifacts")
      const download = vi.spyOn(fixture.client, "downloadArtifact")
      const write = vi.spyOn(fixture.storage, "write")

      await expect(fixture.importRun()).resolves.toEqual({
        dist: "ignored",
        screenshots: "absent",
      })

      const stopped = await fixture.findBuild()
      expect(stopped).toMatchObject({
        id: before.id,
        state: "failed",
        workflowCompletedAt: observedStatus === "completed" ? fixture.run.updatedAt : null,
        githubWorkflowRunId: before.githubWorkflowRunId,
        commitSha: before.commitSha,
        artifacts: [],
        prototype: before.prototype,
      })
      if (before.startedAt) expect(stopped.startedAt).toEqual(before.startedAt)
      else expect(stopped.startedAt).toBeInstanceOf(Date)
      expect(stopped.finishedAt).toBeInstanceOf(Date)
      expect(stopped.failureSummary).toMatch(/default branch/i)
      expect(stopped.failureSummary).toContain("builds.workflows")
      expect(await prisma.branchHeadObservation.findMany()).toEqual(observations)
      expect(fixture.client.getCommitAuthor).not.toHaveBeenCalled()
      expect(listArtifacts).not.toHaveBeenCalled()
      expect(download).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      const awaiting = await listGitHubBuildsAwaitingImport(prisma, { createdAfter })

      fixture.workflowPaths.push(".github/workflows/replica.yml")
      const discovered = await discoverGitHubWorkflowRuns(
        {
          database: prisma,
          listWorkflowRuns: () => Promise.resolve([fixture.run]),
          listBranchHeads: () => Promise.resolve([]),
          isAncestor: () => Promise.resolve(false),
          logger,
        },
        { createdAfter },
      )
      expect({ awaiting, discovered }).toEqual({ awaiting: [], discovered: [] })
      await fixture.importRun()
      expect(await fixture.findBuild()).toMatchObject({
        state: "failed",
        failureSummary: stopped.failureSummary,
        artifacts: [],
      })
      expect(write).not.toHaveBeenCalled()

      fixture.run.runAttempt += 1
      fixture.run.status = "in_progress"
      await expect(fixture.importRun()).resolves.toMatchObject({ dist: "imported" })
      expect(await fixture.findBuild()).toMatchObject({
        id: before.id,
        state: "successful",
        failureSummary: null,
        githubWorkflowRunAttempt: fixture.run.runAttempt,
      })
    },
  )

  it.each([
    "older owner",
    "newer owner",
    "newer attempt",
    "different commit",
    "different branch",
    "superseded Build",
    "retired branch",
    "disconnected repository",
  ])("does not settle a deselected run's %s", async (boundary) => {
    const fixture = await createFixture()
    await fixture.importRun()
    const build = await fixture.findBuild()
    if (boundary === "older owner") {
      fixture.run.id += 1
    } else if (boundary === "newer owner") {
      await prisma.build.update({
        where: { id: build.id },
        data: { githubWorkflowRunId: BigInt(fixture.run.id + 1) },
      })
    } else if (boundary === "newer attempt") {
      await prisma.build.update({
        where: { id: build.id },
        data: { githubWorkflowRunAttempt: fixture.run.runAttempt + 1 },
      })
    } else if (boundary === "different commit") {
      fixture.run.headSha = "b".repeat(40)
    } else if (boundary === "different branch") {
      fixture.run.headBranch = "proto/another"
    } else if (boundary === "superseded Build") {
      await prisma.build.update({
        where: { id: build.id },
        data: { state: "superseded", startedAt: null, finishedAt: new Date() },
      })
    } else if (boundary === "retired branch") {
      await prisma.prototype.update({
        where: { id: build.prototypeId },
        data: { branchDeletedAt: new Date() },
      })
    } else {
      await prisma.repository.update({
        where: { githubRepositoryId: fixture.run.repositoryId },
        data: { removedAt: new Date() },
      })
    }
    const before = await fixture.findBuild()
    fixture.workflowPaths.splice(0)
    const listArtifacts = vi.spyOn(fixture.client, "listRunArtifacts")

    await expect(fixture.importRun()).resolves.toEqual({
      dist: "ignored",
      screenshots: "absent",
    })

    expect(await fixture.findBuild()).toEqual(before)
    expect(await prisma.build.count()).toBe(1)
    expect(listArtifacts).not.toHaveBeenCalled()
  })

  it("preserves a successful Build and its owner when its workflow is deselected", async () => {
    const fixture = await createFixture()
    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    fixture.packages.set(distArtifactName, distPackage())
    fixture.packages.set(
      screenshotArtifactName,
      screenshotPackage(extractDistPackage(distPackage()).distDigest),
    )
    await fixture.importRun()
    const before = await fixture.findBuild()
    fixture.workflowPaths.splice(0)
    fixture.run.runAttempt += 1
    const listArtifacts = vi.spyOn(fixture.client, "listRunArtifacts")

    await expect(fixture.importRun()).resolves.toEqual({
      dist: "ignored",
      screenshots: "absent",
    })

    expect(await fixture.findBuild()).toEqual(before)
    expect(listArtifacts).not.toHaveBeenCalled()
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
    expect(prototype.registeredAt).toBeNull()
    const events = await fixture.findAnalyticsEvents()
    expect(events).toHaveLength(2)
    expect(events).toContainEqual({
      eventName: "prototype_first_published",
      prototypeId: prototype.id,
      buildId: newer.id,
    })
    expect(events).toContainEqual({
      eventName: "build_published",
      prototypeId: prototype.id,
      buildId: prototype.builds[1]?.id,
    })
  })

  it("keeps the higher run ID selected when a lower ID arrives at the same timestamp", async () => {
    const fixture = await createFixture()
    fixture.run.id = 200
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const selected = await fixture.findBuild()

    fixture.run.id -= 1
    fixture.run.headSha = "b".repeat(40)
    await fixture.importRun()

    const prototype = await prisma.prototype.findUniqueOrThrow({
      where: { id: selected.prototypeId },
      include: { builds: true },
    })
    expect(prototype.builds).toHaveLength(2)
    expect(prototype).toMatchObject({
      currentBuildId: selected.id,
      branchHeadSha: "a".repeat(40),
    })
  })

  it("records no artifacts when a newer attempt takes over during the download", async () => {
    const fixture = await createFixture()
    await fixture.importRun()
    const { id } = await fixture.findBuild()
    fixture.packages.set(distArtifactName, distPackage())
    fixture.hooks.beforeDownload = async () => {
      await prisma.build.update({ where: { id }, data: { githubWorkflowRunAttempt: 2 } })
    }

    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "unchanged" })
    expect(await fixture.findBuild()).toMatchObject({ state: "running", distDigest: null })
    await expect(prisma.buildArtifact.count({ where: { buildId: id } })).resolves.toBe(0)
  })

  it("makes a reused Build current when the branch returns to its commit", async () => {
    const fixture = await createFixture()
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const first = await fixture.findBuild()
    const firstRunId = fixture.run.id

    fixture.run.id += 1
    fixture.run.headSha = "b".repeat(40)
    fixture.run.createdAt = new Date("2026-01-02T00:00:00Z")
    await fixture.importRun()
    const secondRunId = fixture.run.id

    fixture.run.id += 1
    fixture.run.headSha = "a".repeat(40)
    fixture.run.createdAt = new Date("2026-01-03T00:00:00Z")
    await fixture.importRun()
    async function current() {
      const prototype = await prisma.prototype.findUniqueOrThrow({
        where: { id: first.prototypeId },
      })
      return prototype.currentBuildId
    }
    await expect(current()).resolves.toBe(first.id)

    fixture.run.id = secondRunId
    fixture.run.headSha = "b".repeat(40)
    fixture.run.createdAt = new Date("2026-01-02T00:00:00Z")
    await fixture.importRun()
    await expect(current()).resolves.toBe(first.id)
    expect(firstRunId).toBeLessThan(secondRunId)
  })

  it("keeps a reused Build selected over an older same-time run's redelivery", async () => {
    const fixture = await createFixture()
    fixture.run.id = 200
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const first = await fixture.findBuild()

    fixture.run.id += 1
    fixture.run.headSha = "b".repeat(40)
    await fixture.importRun()
    const second = await prisma.build.findUniqueOrThrow({
      where: {
        prototypeId_commitSha: { prototypeId: first.prototypeId, commitSha: "b".repeat(40) },
      },
    })
    fixture.run.id += 1
    fixture.run.headSha = "a".repeat(40)
    await fixture.importRun()
    const olderSelectingRunId = fixture.run.id
    fixture.run.id += 1
    fixture.run.headSha = "b".repeat(40)
    await fixture.importRun()

    fixture.run.id = olderSelectingRunId
    fixture.run.headSha = "a".repeat(40)
    await fixture.importRun()

    expect(
      await prisma.prototype.findUniqueOrThrow({ where: { id: first.prototypeId } }),
    ).toMatchObject({
      currentBuildId: second.id,
      branchHeadSha: "b".repeat(40),
    })
  })

  it("keeps a polled prior commit selected when its later run is redelivered", async () => {
    const fixture = await createFixture()
    fixture.run.id = 200
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const first = await fixture.findBuild()

    fixture.run.id += 1
    fixture.run.headSha = "b".repeat(40)
    await fixture.importRun()
    const second = await prisma.build.findUniqueOrThrow({
      where: {
        prototypeId_commitSha: { prototypeId: first.prototypeId, commitSha: "b".repeat(40) },
      },
    })
    fixture.run.id += 1
    await fixture.importRun()
    expect(
      await prisma.prototype.findUniqueOrThrow({ where: { id: first.prototypeId } }),
    ).toMatchObject({
      currentBuildId: second.id,
      branchHeadSha: "b".repeat(40),
    })
    await refreshGitHubBranchHeads(
      {
        database: prisma,
        listBranchHeads: () =>
          Promise.resolve([{ branchName: fixture.run.headBranch!, commitSha: "a".repeat(40) }]),
        isAncestor: () => Promise.resolve(false),
      },
      fixture.run.repositoryId,
    )
    expect(
      await prisma.prototype.findUniqueOrThrow({ where: { id: first.prototypeId } }),
    ).toMatchObject({
      currentBuildId: first.id,
      branchHeadSha: "a".repeat(40),
    })

    await fixture.importRun()

    expect(
      await prisma.prototype.findUniqueOrThrow({ where: { id: first.prototypeId } }),
    ).toMatchObject({
      currentBuildId: first.id,
      branchHeadSha: "a".repeat(40),
    })
  })

  it("processes a same-run attempt without undoing a polled head", async () => {
    const fixture = await createFixture()
    fixture.run.id = 200
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const first = await fixture.findBuild()
    fixture.run.id += 1
    fixture.run.headSha = "b".repeat(40)
    await fixture.importRun()
    const second = await prisma.build.findUniqueOrThrow({
      where: {
        prototypeId_commitSha: { prototypeId: first.prototypeId, commitSha: "b".repeat(40) },
      },
    })
    await refreshGitHubBranchHeads(
      {
        database: prisma,
        listBranchHeads: () =>
          Promise.resolve([{ branchName: fixture.run.headBranch!, commitSha: "a".repeat(40) }]),
        isAncestor: () => Promise.resolve(false),
      },
      fixture.run.repositoryId,
    )

    fixture.run.runAttempt = 2
    await fixture.importRun()

    expect(await prisma.build.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      state: "successful",
      githubWorkflowRunAttempt: 2,
    })
    expect(
      await prisma.prototype.findUniqueOrThrow({ where: { id: first.prototypeId } }),
    ).toMatchObject({
      currentBuildId: first.id,
      branchHeadSha: "a".repeat(40),
    })
  })

  it("keeps a failed Build failed when the same attempt is delivered again", async () => {
    const fixture = await createFixture()
    fixture.run.status = "completed"
    fixture.run.conclusion = "failure"
    await fixture.importRun()

    fixture.packages.set(distArtifactName, distPackage())
    await expect(fixture.importRun()).resolves.toMatchObject({ dist: "unchanged" })
    expect(await fixture.findBuild()).toMatchObject({
      state: "failed",
      failureSummary: "The GitHub Actions workflow run ended with failure.",
      artifacts: [],
    })
  })

  it("clears workflow completion when a newer attempt reopens a failed Build", async () => {
    const fixture = await createFixture()
    fixture.run.status = "completed"
    fixture.run.conclusion = "failure"
    await fixture.importRun()
    const before = await fixture.findBuild()
    expect(before.workflowCompletedAt).not.toBeNull()

    fixture.run.runAttempt = 2
    fixture.run.status = "in_progress"
    fixture.run.conclusion = null
    fixture.run.startedAt = new Date("2026-01-01T00:02:00Z")
    await expect(fixture.importRun()).resolves.toEqual({
      dist: "pending",
      screenshots: "absent",
    })
    expect(await fixture.findBuild()).toMatchObject({
      id: before.id,
      state: "running",
      githubWorkflowRunAttempt: 2,
      workflowCompletedAt: null,
      failureSummary: null,
      artifacts: [],
    })
  })
})

describe("recordGitHubBuildAuthor", () => {
  it("repairs a successful legacy Build without reimporting artifacts or reselecting it", async () => {
    const fixture = await createFixture()
    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    fixture.packages.set(distArtifactName, distPackage())
    await fixture.importRun()
    const legacy = await fixture.findBuild()
    await prisma.user.create({
      data: {
        externalIdentities: {
          create: { provider: "github", issuer: "https://github.com", subject: "101" },
        },
      },
    })
    fixture.run.id += 1
    fixture.run.headSha = "b".repeat(40)
    fixture.run.createdAt = new Date("2026-01-01T00:02:00Z")
    fixture.run.updatedAt = new Date("2026-01-01T00:03:00Z")
    await fixture.importRun()
    const selected = await prisma.prototype.findUniqueOrThrow({
      where: { id: legacy.prototypeId },
    })
    expect(selected.currentBuildId).not.toBe(legacy.id)
    const author = {
      providerUserId: "101",
      login: "commit-author",
      avatarUrl: "https://avatars.githubusercontent.com/u/101",
    }
    const write = vi.spyOn(fixture.storage, "write")
    const download = vi.spyOn(fixture.client, "downloadArtifact")
    const input = {
      buildId: legacy.id,
      commitSha: legacy.commitSha!,
      githubRepositoryId: fixture.run.repositoryId,
      githubWorkflowRunId: legacy.githubWorkflowRunId,
      author,
    }

    await recordGitHubBuildAuthor(prisma, input)

    const repaired = await fixture.findBuild(legacy.id)
    expect(repaired).toMatchObject({
      id: legacy.id,
      state: "successful",
      commitSha: legacy.commitSha,
      distDigest: legacy.distDigest,
      githubWorkflowRunId: legacy.githubWorkflowRunId,
      githubWorkflowRunAttempt: legacy.githubWorkflowRunAttempt,
      workflowCompletedAt: legacy.workflowCompletedAt,
      startedAt: legacy.startedAt,
      finishedAt: legacy.finishedAt,
      artifacts: legacy.artifacts,
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: "101",
      authorLogin: author.login,
      authorAvatarUrl: author.avatarUrl,
      prototype: {
        authorId: null,
        currentBuildId: selected.currentBuildId,
        currentBuildRunCreatedAt: selected.currentBuildRunCreatedAt,
        currentBuildRunId: selected.currentBuildRunId,
        registeredAt: selected.registeredAt,
      },
    })

    await recordGitHubBuildAuthor(prisma, input)

    expect(await fixture.findBuild(legacy.id)).toEqual(repaired)
    expect(await prisma.build.count()).toBe(2)
    expect(await prisma.user.count()).toBe(1)
    expect(await prisma.externalIdentity.count()).toBe(1)
    expect(write).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it("does not replace an existing Build author snapshot or prototype owner", async () => {
    const fixture = await createFixture()
    const owner = await prisma.user.create({ data: {} })
    fixture.client.getCommitAuthor.mockResolvedValue({
      providerUserId: "101",
      login: "saved-author",
      avatarUrl: null,
    })
    await fixture.importRun()
    const build = await fixture.findBuild()
    await prisma.prototype.update({
      where: { id: build.prototypeId },
      data: { authorId: owner.id },
    })
    await prisma.build.update({
      where: { id: build.id },
      data: { authorName: "Saved author name" },
    })
    const before = await fixture.findBuild()

    const input = {
      buildId: before.id,
      commitSha: before.commitSha!,
      githubRepositoryId: fixture.run.repositoryId,
      githubWorkflowRunId: before.githubWorkflowRunId,
      author: { providerUserId: "202", login: "different-author", avatarUrl: null },
    }
    await recordGitHubBuildAuthor(prisma, input)

    expect(await fixture.findBuild()).toEqual(before)
    expect(await prisma.user.count()).toBe(1)
  })
})
