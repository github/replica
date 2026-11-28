import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, request as httpRequest, type RequestListener } from "node:http"

import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../create-app"
import type { AzureBlobArtifactSettings } from "../../../integrations/azure-blob/create-azure-blob-artifact-storage/types"
import type {
  GitHubWorkflowArtifact,
  GitHubWorkflowRun,
} from "../../../integrations/github/create-github-actions-client/types"
import { GitHubCommitLookupError } from "../../../integrations/github/errors"
import { createLogger } from "../../../integrations/pino/create-logger"
import { prisma } from "../../../integrations/prisma"
import { createAuthorityClient } from "../../../integrations/private-preview/create-authority-client"
import { findBuildArtifact } from "../../../repositories/build-artifacts/find-build-artifact"
import { listGitHubBuildsAwaitingImport } from "../../../repositories/github-builds/list-github-builds-awaiting-import"
import { createPrivatePreviewAccessStore } from "../../../repositories/private-previews/create-private-preview-access-store"
import { findPrivatePreviewDistFile } from "../../../repositories/private-previews/find-private-preview-dist-file"
import { findPrivatePreviewTarget } from "../../../repositories/private-previews/find-private-preview-target"
import { findPrototypeDetail } from "../../../repositories/prototype-index/find-prototype-detail"
import { createGitHubWebhookRouteDependencies } from "../../../routes/api/github/webhooks/create-github-webhook-route-dependencies"
import { createPrivatePreviewReader } from "../../../routes/private-preview-reader"
import { createZipArchive } from "../../../test/create-zip-archive"
import { privatePreviewAddress } from "../../../utils/private-preview-address"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types"
import { extractDistPackage } from "../../build-artifacts/extract-dist-package"
import { readBuildPreviewFile } from "../../build-preview/read-build-preview-file"
import { createPrivatePreviewAuthority } from "../../private-preview/create-authority"
import {
  readerAuthorizePath,
  readerExchangePath,
  sessionLifetime,
} from "../../private-preview/types"
import { distArtifactName, screenshotArtifactName } from "../constants"
import { discoverGitHubWorkflowRuns } from "../discover-github-workflow-runs"
import type { GitHubWorkflowRunJob } from "../get-github-workflow-run-job-definition"
import { refreshGitHubBranchHeads } from "../refresh-github-branch-heads"
import { importGitHubWorkflowRun } from "."
import type { ImportGitHubWorkflowRunDependencies } from "./types"

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
  const repository = await prisma.repository.create({
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
  function importRun(
    job = { githubRepositoryId, runId: run.id },
    privatePreviewWriter?: ImportGitHubWorkflowRunDependencies["privatePreviewWriter"],
  ) {
    return importGitHubWorkflowRun(
      { database: prisma, storage, client, logger, privatePreviewWriter },
      job,
    )
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
    repository,
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

async function createPrototypeFixture() {
  const fixture = await createFixture()
  fixture.run.headBranch = "proto/welcome"
  return fixture
}

function privatePreviewPackage(basePath: string, asset = Buffer.from([0, 255, 9])) {
  return createZipArchive([
    { name: "dist/index.html", bytes: "<h1>Home</h1>" },
    { name: "dist/assets/app.bin", bytes: asset },
    { name: "dist/replica-preview-base.json", bytes: JSON.stringify({ basePath }) },
    { name: "templates.json", bytes: JSON.stringify({ version: 1, templates: [] }) },
  ])
}

function createPrivatePreviewDestination(repositoryId: number) {
  const storage = createImmutableStorage()
  return {
    storage,
    writer: {
      repositoryId: String(repositoryId),
      storage: {
        read: vi.fn(storage.read.bind(storage)),
        write: vi.fn(storage.write.bind(storage)),
      },
    },
  }
}

async function preparePrivatePreviewReplay(source: ArtifactStorage, destination: ArtifactStorage) {
  const originalEnvironment = process.env
  process.env = {
    NODE_ENV: originalEnvironment.NODE_ENV,
    DATABASE_URL: originalEnvironment.DATABASE_URL,
    ARTIFACT_STORAGE_PROVIDER: "azure",
    AZURE_STORAGE_ACCOUNT: "synthetic",
    AZURE_STORAGE_CONTAINER: "ordinary-artifacts",
    LOG_LEVEL: "info",
  }
  function monitor(storage: ArtifactStorage) {
    return {
      isReady: vi.fn(() => storage.isReady()),
      read: vi.fn((key: string) => storage.read(key)),
      write: vi.fn((key: string, bytes: Uint8Array) => storage.write(key, bytes)),
      delete: vi.fn((key: string) => storage.delete(key)),
    }
  }
  const ordinary = monitor(source)
  const preview = monitor(destination)
  const blobOperations = [...Object.values(ordinary), ...Object.values(preview)]
  function blobCalls() {
    return blobOperations.reduce((count, operation) => count + operation.mock.calls.length, 0)
  }
  vi.doMock("../../../integrations/azure-blob/create-azure-blob-artifact-storage", () => ({
    createAzureBlobArtifactStorage({ container }: AzureBlobArtifactSettings) {
      if (container === "ordinary-artifacts") return ordinary
      if (container === "private-preview-artifacts") return preview
      throw new Error("Unexpected synthetic Blob container.")
    },
  }))
  onTestFinished(() => {
    vi.doUnmock("../../../integrations/azure-blob/create-azure-blob-artifact-storage")
    process.env = originalEnvironment
  })
  vi.spyOn(prisma, "$disconnect").mockResolvedValue(undefined)
  const { runPrivatePreviewReplay } = await import("../../../scripts/replay-private-preview/run")

  return async function replay(
    { repositoryId, runId, buildId }: { repositoryId: number; runId: number; buildId: string },
    enabledFor?: number,
    prepareDistDigest?: string,
  ) {
    if (enabledFor === undefined) {
      delete process.env.HUB_PRIVATE_PREVIEW_WRITE_ENABLED
      delete process.env.HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID
      delete process.env.HUB_PRIVATE_PREVIEW_WRITE_CONTAINER
    } else {
      process.env.HUB_PRIVATE_PREVIEW_WRITE_ENABLED = "true"
      process.env.HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID = String(enabledFor)
      process.env.HUB_PRIVATE_PREVIEW_WRITE_CONTAINER = "private-preview-artifacts"
    }
    const callsBefore = blobCalls()
    const originalExitCode = process.exitCode
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true)
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    process.exitCode = undefined
    try {
      await runPrivatePreviewReplay([
        "--repository-id",
        String(repositoryId),
        "--run-id",
        String(runId),
        "--build-id",
        buildId,
        ...(prepareDistDigest === undefined ? [] : ["--prepare-dist-digest", prepareDistDigest]),
      ])
      return {
        exitCode: process.exitCode,
        stdout: stdout.mock.calls.map(([chunk]) => String(chunk)).join(""),
        stderr: stderr.mock.calls.map(([chunk]) => String(chunk)).join(""),
        blobCalls: blobCalls() - callsBefore,
      }
    } finally {
      process.exitCode = originalExitCode
      stdout.mockRestore()
      stderr.mockRestore()
    }
  }
}

async function readPrivatePreviewAvailability(
  build: { prototype: { repositoryId: string }; prototypeId: string; number: number },
  address: NonNullable<ReturnType<typeof privatePreviewAddress>>,
) {
  const detail = await findPrototypeDetail(
    prisma,
    build.prototype.repositoryId,
    build.prototypeId,
    build.number,
    undefined,
    null,
    undefined,
    "https://hub.example.com",
  )
  return [
    detail?.selectedBuild?.privatePreviewUrl,
    detail?.prototype.builds.find(({ number }) => number === build.number)?.privatePreviewUrl,
    (await findPrivatePreviewTarget(prisma, address))?.buildId,
  ]
}

async function expectPrivatePreviewHidden(
  build: Parameters<typeof readPrivatePreviewAvailability>[0],
  address: Parameters<typeof readPrivatePreviewAvailability>[1],
) {
  await expect(readPrivatePreviewAvailability(build, address)).resolves.toEqual([
    undefined,
    undefined,
    undefined,
  ])
}

async function listenBehindProxy(origin: string, app: RequestListener) {
  const host = new URL(origin).host
  const server = createServer((request, response) => {
    request.headers.host = host
    request.headers["x-forwarded-proto"] = "https"
    app(request, response)
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address.")
  return `http://127.0.0.1:${address.port}`
}

describe("importGitHubWorkflowRun", () => {
  describe("private preview publishing", () => {
    it("serves the owning run's published Build only after a Hub handoff", async () => {
      const fixture = await createPrototypeFixture()
      const { repositoryId, id } = fixture.run
      const address = privatePreviewAddress(String(repositoryId), String(id))!
      const { storage, writer } = createPrivatePreviewDestination(repositoryId)
      const asset = Buffer.from([0, 255, 37, 128])
      const archive = privatePreviewPackage(`/previews/github/${repositoryId}/${id}/`, asset)
      fixture.packages.set(distArtifactName, archive)
      fixture.packages.set(
        screenshotArtifactName,
        screenshotPackage(extractDistPackage(archive).distDigest),
      )

      const settings = {
        hubOrigin: "https://hub.example.com",
        readerOrigin: "https://preview.hub.example.com",
        readerSecret: randomBytes(32).toString("base64url"),
        inline: false,
      }
      const launch = `${settings.hubOrigin}/api/private-preview/launch/${repositoryId}/${id}`
      const session = randomBytes(32).toString("base64url")
      const sessionDigest = createHash("sha256").update(session).digest("hex")
      const hubCookie = `__Host-hub_session=${session}`
      const viewer = {
        userId: randomUUID(),
        membershipId: randomUUID(),
        role: "MEMBER" as const,
        sessionProvider: "github",
      }
      // Sign-in and GitHub permissions are fixture boundaries; the grant and playback checks are real.
      function hasAccess(_viewer: typeof viewer, repo: string) {
        return Promise.resolve(repo === fixture.repository.id)
      }
      const authority = createPrivatePreviewAuthority({
        readerOrigin: settings.readerOrigin,
        storage: fixture.storage,
        access: createPrivatePreviewAccessStore(prisma, sessionLifetime),
        restoreSession: (digest) => Promise.resolve(digest === sessionDigest ? viewer : null),
        isRepositoryVisible: hasAccess,
        hasCurrentRepositoryAccess: hasAccess,
        findTarget: (target) => findPrivatePreviewTarget(prisma, target),
        findDistFile: (buildId, path) => findPrivatePreviewDistFile(prisma, buildId, path),
      })
      const hub = await listenBehindProxy(
        settings.hubOrigin,
        createApp({
          logger: createLogger({ level: "silent" }),
          trustedProxyHops: 1,
          privatePreview: {
            settings,
            authority,
            hasCurrentHubSession: (digest) => Promise.resolve(digest === sessionDigest),
          },
        }),
      )
      const client = createAuthorityClient(hub, settings.readerSecret)
      // Fetch replaces Sec-Fetch-Mode, so send the browser navigation headers directly.
      function navigate(url: string, headers: Record<string, string>, body?: string) {
        return new Promise<Response>((resolve, reject) => {
          const target = new URL(url)
          httpRequest(
            {
              host: target.hostname,
              port: target.port,
              path: `${target.pathname}${target.search}`,
              method: body === undefined ? "GET" : "POST",
              headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", ...headers },
            },
            (response) => {
              const chunks: Buffer[] = []
              response.on("data", (chunk: Buffer) => chunks.push(chunk))
              response.on("error", reject)
              response.on("end", () => {
                const responseHeaders = new Headers()
                for (const [name, value] of Object.entries(response.headers)) {
                  for (const item of [value ?? []].flat()) responseHeaders.append(name, item)
                }
                resolve(
                  new Response(Buffer.concat(chunks), {
                    status: response.statusCode!,
                    headers: responseHeaders,
                  }),
                )
              })
            },
          )
            .on("error", reject)
            .end(body)
        })
      }
      // Hub and the reader share a site, so every handoff form is a same-site navigation.
      function post(
        base: string,
        path: string,
        fields: Record<string, string>,
        origin: string,
        cookie?: string,
      ) {
        return navigate(
          `${base}${path}`,
          {
            origin,
            "content-type": "application/x-www-form-urlencoded",
            "sec-fetch-site":
              base === hub && origin === settings.hubOrigin ? "same-origin" : "same-site",
            ...(cookie ? { cookie } : {}),
          },
          new URLSearchParams(fields).toString(),
        )
      }
      async function formValue(response: Response, action: string, field: string) {
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).toContain(`<form method="post" action="${action}">`)
        return html.match(new RegExp(`name="${field}" value="([^"]+)"`))![1]!
      }
      const reader = await listenBehindProxy(
        settings.readerOrigin,
        createPrivatePreviewReader({
          settings,
          trustedProxyHops: 1,
          exchange: (grant, { repositoryId, runId }, challengeDigest) =>
            client.exchange(readerExchangePath, { repositoryId, runId, grant, challengeDigest }),
          authorizeFile: (access, { repositoryId, runId }, path, allowEntryPointFallback) =>
            client.authorizeFile(readerAuthorizePath, {
              access,
              repositoryId,
              runId,
              path,
              allowEntryPointFallback,
            }),
          readArtifact: (key) => storage.read(key),
        }),
      )

      writer.storage.write.mockImplementationOnce(async (key, bytes) => {
        const pending = await fixture.findBuild()
        expect(pending).toMatchObject({ state: "successful", privatePreviewState: "pending" })
        await expectPrivatePreviewHidden(pending, address)
        const response = await post(
          hub,
          address.launch,
          { start: "one-click", buildId: pending.id },
          settings.hubOrigin,
          hubCookie,
        )
        expect(response.status).toBe(404)
        await expect(storage.read(key)).resolves.toEqual({ status: "not-found" })
        return storage.write(key, bytes)
      })
      await expect(fixture.importRun(undefined, writer)).resolves.toEqual({
        dist: "imported",
        screenshots: "attached",
      })

      const build = await fixture.findBuild()
      expect(build).toMatchObject({ state: "successful", privatePreviewState: "ready" })
      expect(build.artifacts.map(({ path }) => path)).toEqual([
        "dist/assets/app.bin",
        "dist/index.html",
        "dist/replica-preview-base.json",
        "screenshots/desktop.png",
        "templates.json",
      ])
      const served = build.artifacts.filter(({ path }) =>
        ["dist/assets/app.bin", "dist/index.html"].includes(path),
      )
      expect(writer.storage.write.mock.calls.map(([key]) => key).sort()).toEqual(
        served.map(({ storageKey }) => storageKey).sort(),
      )
      await expect(readPrivatePreviewAvailability(build, address)).resolves.toEqual([
        launch,
        launch,
        build.id,
      ])

      const assetPath = `${address.mount}assets/app.bin`
      const oneClick = { start: "one-click", buildId: build.id }
      expect((await post(hub, address.launch, oneClick, settings.hubOrigin)).status).toBe(401)

      // One click on the Build page reaches the exact Build without a confirmation page.
      const intent = await formValue(
        await post(hub, address.launch, oneClick, settings.hubOrigin, hubCookie),
        `${settings.readerOrigin}${address.begin}`,
        "intent",
      )
      const begun = await post(reader, address.begin, { intent }, settings.hubOrigin)
      const challengeCookie = begun.headers.getSetCookie()[0]!.split(";")[0]!
      const continuation = await formValue(
        begun,
        `${settings.hubOrigin}${address.launchReturn}`,
        "continuation",
      )
      // The same-site return carries the Hub session, so Hub issues the handoff directly.
      const handoff = await post(
        hub,
        address.launchReturn,
        { continuation },
        settings.readerOrigin,
        hubCookie,
      )
      const ticket = await formValue(
        handoff,
        `${settings.readerOrigin}${address.exchange}`,
        "grant",
      )
      const replay = await post(
        hub,
        address.launchReturn,
        { continuation },
        settings.readerOrigin,
        hubCookie,
      )
      expect(replay.status).toBe(404)
      const exchanged = await post(
        reader,
        address.exchange,
        { grant: ticket },
        settings.hubOrigin,
        challengeCookie,
      )
      expect(exchanged.status).toBe(303)
      expect(exchanged.headers.get("location")).toBe(address.mount)
      const readerCookies = exchanged.headers.getSetCookie().map((value) => value.split(";")[0]!)
      const readerCookie = readerCookies.find((value) =>
        value.startsWith(`__Secure-replica-preview-${repositoryId}-`),
      )!
      const browserCookie = readerCookies.find((value) =>
        value.startsWith("__Host-replica-preview-browser="),
      )!
      const markerCookie = readerCookies.find((value) =>
        value.startsWith("__Secure-replica-preview-build-"),
      )!

      const file = await fetch(`${reader}${assetPath}`, {
        headers: { cookie: `${readerCookie}; ${browserCookie}` },
      })
      expect(file.status).toBe(200)
      expect(Buffer.from(await file.arrayBuffer())).toEqual(asset)
      expect((await fetch(`${reader}${assetPath}`)).status).toBe(404)

      for (const path of [address.mount, `${address.mount}settings/display`]) {
        const page = await fetch(`${reader}${path}`, {
          headers: { cookie: `${readerCookie}; ${browserCookie}`, "sec-fetch-dest": "document" },
        })
        expect(page.status).toBe(200)
        expect(await page.text()).toBe("<h1>Home</h1>")
      }

      // After the reader session ends, an in-prototype navigation renews and keeps its route.
      await prisma.privatePreviewAccess.updateMany({
        where: { buildId: build.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      })
      const destination = `${address.mount}settings/display?tab=2`
      const navigation = await navigate(`${reader}${destination}`, {
        cookie: `${readerCookie}; ${markerCookie}; ${browserCookie}`,
        "sec-fetch-site": "same-origin",
      })
      const resumeCookie = navigation.headers.getSetCookie()[0]!.split(";")[0]!
      const resume = await formValue(
        navigation,
        `${settings.hubOrigin}${address.launchReturn}`,
        "resume",
      )
      const signedOut = await post(hub, address.launchReturn, { resume }, settings.readerOrigin)
      expect(signedOut.status).toBe(303)
      expect(signedOut.headers.get("location")).toBe("/")
      const renewal = await formValue(
        await post(hub, address.launchReturn, { resume }, settings.readerOrigin, hubCookie),
        `${settings.readerOrigin}${address.exchange}`,
        "grant",
      )
      const renewed = await post(
        reader,
        address.exchange,
        { grant: renewal },
        settings.hubOrigin,
        `${resumeCookie}; ${browserCookie}`,
      )
      expect(renewed.status).toBe(303)
      expect(renewed.headers.get("location")).toBe(destination)
      const renewedCookie = renewed.headers
        .getSetCookie()
        .map((value) => value.split(";")[0]!)
        .find((value) => value.startsWith(`__Secure-replica-preview-${repositoryId}-`))!
      const page = await fetch(`${reader}${destination}`, {
        headers: { cookie: `${renewedCookie}; ${browserCookie}`, "sec-fetch-dest": "document" },
      })
      expect(page.status).toBe(200)
      expect(await page.text()).toBe("<h1>Home</h1>")
    })

    it.each([
      { condition: "another configured repository", otherWriterRepository: true },
      { condition: "a marker for another repository", markerRepositoryOffset: 1 },
      { condition: "a marker for another run", markerRunOffset: 1 },
      { condition: "a missing trailing slash", noTrailingSlash: true },
      { condition: "no marker", noMarker: true },
      { condition: "a local repository", local: true },
      { condition: "a branch outside proto/", headBranch: "prototype/welcome" },
    ])(
      "does not publish for $condition",
      async ({
        otherWriterRepository,
        markerRepositoryOffset = 0,
        markerRunOffset = 0,
        noTrailingSlash,
        noMarker,
        local,
        headBranch,
      }) => {
        const fixture = await createPrototypeFixture()
        if (headBranch) fixture.run.headBranch = headBranch
        const { repositoryId, id } = fixture.run
        const address = privatePreviewAddress(String(repositoryId), String(id))!
        const { writer } = createPrivatePreviewDestination(
          otherWriterRepository ? repositoryId + 1 : repositoryId,
        )
        if (local) {
          await prisma.repository.update({
            where: { githubRepositoryId: repositoryId },
            data: { localPath: "/synthetic/repository" },
          })
        }
        const basePath = `/previews/github/${repositoryId + markerRepositoryOffset}/${id + markerRunOffset}${noTrailingSlash ? "" : "/"}`
        fixture.packages.set(
          distArtifactName,
          noMarker ? distPackage() : privatePreviewPackage(basePath),
        )

        await expect(fixture.importRun(undefined, writer)).resolves.toMatchObject({
          dist: "imported",
        })

        const build = await fixture.findBuild()
        expect(build.state).toBe("successful")
        expect(writer.storage.read).not.toHaveBeenCalled()
        expect(writer.storage.write).not.toHaveBeenCalled()
        await expectPrivatePreviewHidden(build, address)
      },
    )

    it("keeps a partial publication private until the owner retries with the retained dist bytes", async () => {
      const fixture = await createPrototypeFixture()
      const { repositoryId, id } = fixture.run
      const address = privatePreviewAddress(String(repositoryId), String(id))!
      const { storage, writer } = createPrivatePreviewDestination(repositoryId)
      writer.storage.write
        .mockResolvedValue({ status: "unavailable" })
        .mockImplementationOnce(storage.write.bind(storage))
      fixture.packages.set(distArtifactName, privatePreviewPackage(address.mount))
      fixture.run.status = "completed"
      fixture.run.conclusion = "success"

      await expect(fixture.importRun(undefined, writer)).rejects.toThrow()

      const build = await fixture.findBuild()
      expect(build).toMatchObject({
        state: "successful",
        privatePreviewState: "pending",
        workflowCompletedAt: fixture.run.updatedAt,
      })
      const [storedKey] = writer.storage.write.mock.calls[0]!
      await expect(storage.read(storedKey)).resolves.toMatchObject({ status: "ok" })
      await expect(
        readBuildPreviewFile(
          { acceptsHtml: false, buildId: build.id, requestPath: "/assets/app.bin" },
          {
            storage: fixture.storage,
            findArtifact: (buildId, file) => findBuildArtifact(prisma, buildId, file),
          },
        ),
      ).resolves.toMatchObject({ status: "ok", bytes: Buffer.from([0, 255, 9]) })
      await expectPrivatePreviewHidden(build, address)

      writer.storage.read.mockClear()
      writer.storage.write.mockClear().mockImplementation(storage.write.bind(storage))
      fixture.run.id = id + 1
      const contributor = privatePreviewAddress(String(repositoryId), String(fixture.run.id))!
      fixture.packages.set(distArtifactName, privatePreviewPackage(contributor.mount))
      fixture.packages.set(screenshotArtifactName, screenshotPackage(build.distDigest!))
      await expect(fixture.importRun(undefined, writer)).resolves.toEqual({
        dist: "unchanged",
        screenshots: "attached",
      })
      expect(writer.storage.read).not.toHaveBeenCalled()
      expect(writer.storage.write).not.toHaveBeenCalled()
      await expect(findPrivatePreviewTarget(prisma, contributor)).resolves.toBeNull()
      await expectPrivatePreviewHidden(build, address)

      fixture.run.id = id
      fixture.packages.set(distArtifactName, privatePreviewPackage(address.mount, Buffer.from([5])))
      await expect(fixture.importRun(undefined, writer)).resolves.toMatchObject({
        dist: "unchanged",
      })

      expect(await fixture.findBuild()).toMatchObject({
        id: build.id,
        privatePreviewState: "ready",
        distDigest: build.distDigest,
      })
      for (const { path, storageKey } of build.artifacts) {
        if (path !== "dist/assets/app.bin" && path !== "dist/index.html") continue
        const original = await fixture.storage.read(storageKey)
        expect(original.status).toBe("ok")
        await expect(storage.read(storageKey)).resolves.toEqual(original)
      }
      const launch = `https://hub.example.com/api/private-preview/launch/${repositoryId}/${id}`
      await expect(readPrivatePreviewAvailability(build, address)).resolves.toEqual([
        launch,
        launch,
        build.id,
      ])
    })

    it("does not replace conflicting destination bytes or expose the Build", async () => {
      const fixture = await createPrototypeFixture()
      const { repositoryId, id } = fixture.run
      const address = privatePreviewAddress(String(repositoryId), String(id))!
      const { storage, writer } = createPrivatePreviewDestination(repositoryId)
      const collision = Buffer.from([0, 80, 9])
      fixture.packages.set(distArtifactName, privatePreviewPackage(address.mount))
      const writeSource = fixture.storage.write.bind(fixture.storage)
      const asset = Buffer.from([0, 255, 9])
      vi.spyOn(fixture.storage, "write").mockImplementation(async (key, bytes) => {
        if (Buffer.from(bytes).equals(asset)) await storage.write(key, collision)
        return writeSource(key, bytes)
      })

      await expect(fixture.importRun(undefined, writer)).rejects.toThrow()

      const build = await fixture.findBuild()
      expect(build).toMatchObject({ state: "successful", privatePreviewState: "pending" })
      const { storageKey } = build.artifacts.find(({ path }) => path === "dist/assets/app.bin")!
      await expect(storage.read(storageKey)).resolves.toEqual({ status: "ok", bytes: collision })
      await expect(fixture.storage.read(storageKey)).resolves.toEqual({
        status: "ok",
        bytes: asset,
      })
      await expectPrivatePreviewHidden(build, address)
    })

    it("replays only the exact owning run after normal import recovery has stopped", async () => {
      const fixture = await createPrototypeFixture()
      const { repositoryId, id: runId } = fixture.run
      const address = privatePreviewAddress(String(repositoryId), String(runId))!
      const { storage: destination, writer } = createPrivatePreviewDestination(repositoryId)
      writer.storage.write.mockResolvedValue({ status: "unavailable" })
      const dist = privatePreviewPackage(address.mount)
      fixture.packages.set(distArtifactName, dist)
      fixture.packages.set(
        screenshotArtifactName,
        screenshotPackage(extractDistPackage(dist).distDigest),
      )
      fixture.run.status = "completed"
      fixture.run.conclusion = "success"

      await expect(fixture.importRun(undefined, writer)).rejects.toThrow()

      const before = await fixture.findBuild()
      const buildId = before.id
      const target = { repositoryId, runId, buildId }
      expect(before).toMatchObject({
        state: "successful",
        privatePreviewState: "pending",
        workflowCompletedAt: fixture.run.updatedAt,
      })
      expect(before.artifacts).toContainEqual(
        expect.objectContaining({ path: "screenshots/desktop.png" }),
      )
      function readReceipts() {
        return prisma.gitHubBuildRunCompletion.findMany({
          where: { buildId },
          orderBy: { githubWorkflowRunId: "asc" },
        })
      }
      await expect(readReceipts()).resolves.toEqual([
        expect.objectContaining({
          githubWorkflowRunId: BigInt(runId),
          runAttempt: fixture.run.runAttempt,
          completedAt: fixture.run.updatedAt,
        }),
      ])
      const contributorRunId = runId + 1
      await prisma.gitHubBuildRunCompletion.create({
        data: {
          buildId,
          githubWorkflowRunId: BigInt(contributorRunId),
          runAttempt: 1,
          completedAt: fixture.run.updatedAt,
        },
      })
      const receipts = await readReceipts()
      await expect(
        listGitHubBuildsAwaitingImport(prisma, { createdAfter: new Date(0) }),
      ).resolves.not.toContainEqual({ githubRepositoryId: repositoryId, runId })
      const author = await prisma.user.create({ data: {} })
      const thread = await prisma.reviewThread.create({
        data: {
          repositoryId: fixture.repository.id,
          prototypeId: before.prototypeId,
          buildId,
          anchor: { schemaVersion: 1, kind: "element", selector: "#content" },
          comments: {
            create: { authorId: author.id, authorLogin: "octocat", body: "Retained review" },
          },
        },
        include: { comments: true },
      })
      const originals = await Promise.all(
        before.artifacts.map(async ({ path, storageKey }) => ({
          path,
          storageKey,
          original: await fixture.storage.read(storageKey),
        })),
      )

      fixture.packages.clear()
      const sourceRead = vi.spyOn(fixture.storage, "read")
      const replay = await preparePrivatePreviewReplay(fixture.storage, destination)
      for (const [wrongTarget, enabledFor] of [
        [target, undefined],
        [{ ...target, repositoryId: repositoryId + 1 }, repositoryId],
        [{ ...target, runId: contributorRunId }, repositoryId],
        [{ ...target, buildId: randomUUID() }, repositoryId],
      ] as const) {
        const denied = await replay(wrongTarget, enabledFor)
        expect(denied).toMatchObject({ exitCode: 1, stdout: "", blobCalls: 0 })
        expect(denied.stderr).toMatch(/\S/)
      }

      const sourceError = new Error("synthetic backend details")
      sourceRead.mockRejectedValueOnce(sourceError)
      const failed = await replay(target, repositoryId)
      expect(failed).toMatchObject({ exitCode: 1, stdout: "" })
      const warning = failed.stderr.split("\n").find((line) => line.startsWith("{"))
      expect(JSON.parse(warning ?? "null")).toMatchObject({
        level: 40,
        buildId,
        runId: String(runId),
        stage: "verify-source",
        reason: "source-unavailable",
      })
      expect(failed.stderr).not.toContain(sourceError.message)
      await expect(fixture.findBuild(buildId)).resolves.toEqual(before)
      for (const { storageKey } of originals) {
        await expect(destination.read(storageKey)).resolves.toEqual({ status: "not-found" })
      }

      const result = await replay(target, repositoryId)
      expect(result.exitCode).toBeUndefined()
      expect(result.stdout.trimEnd().split("\n")).toHaveLength(1)
      expect(JSON.parse(result.stdout)).toEqual({ status: "ready", buildId, runId: String(runId) })
      expect(JSON.parse(result.stderr)).toMatchObject({ level: 30, buildId, runId: String(runId) })
      const after = await fixture.findBuild(buildId)
      expect(after).toEqual({ ...before, updatedAt: after.updatedAt, privatePreviewState: "ready" })
      await expect(readReceipts()).resolves.toEqual(receipts)
      await expect(
        prisma.reviewThread.findUniqueOrThrow({
          where: { id: thread.id },
          include: { comments: true },
        }),
      ).resolves.toEqual(thread)
      for (const { path, storageKey, original } of originals) {
        if (original.status !== "ok") throw new Error(`Missing retained fixture artifact: ${path}`)
        await expect(fixture.storage.read(storageKey)).resolves.toEqual(original)
        const served = path === "dist/assets/app.bin" || path === "dist/index.html"
        await expect(destination.read(storageKey)).resolves.toEqual(
          served
            ? { status: "ok", bytes: Uint8Array.from(original.bytes) }
            : { status: "not-found" },
        )
      }
      await expect(replay(target, repositoryId)).resolves.toEqual({
        ...result,
        stderr: "",
        blobCalls: 0,
      })
    })

    it("writes nothing when retained source bytes no longer match the imported dist digest", async () => {
      const fixture = await createPrototypeFixture()
      const { repositoryId, id } = fixture.run
      const address = privatePreviewAddress(String(repositoryId), String(id))!
      const { writer } = createPrivatePreviewDestination(repositoryId)
      const original = Buffer.from([0, 255, 9])
      fixture.packages.set(distArtifactName, privatePreviewPackage(address.mount, original))
      const readSource = fixture.storage.read.bind(fixture.storage)
      vi.spyOn(fixture.storage, "read").mockImplementation(async (key) => {
        const stored = await readSource(key)
        return stored.status === "ok" && original.equals(stored.bytes)
          ? { status: "ok", bytes: Buffer.from([0, 80, 9]) }
          : stored
      })

      await expect(fixture.importRun(undefined, writer)).rejects.toThrow()

      expect(writer.storage.write).not.toHaveBeenCalled()
      expect(await fixture.findBuild()).toMatchObject({
        state: "successful",
        privatePreviewState: "pending",
      })
    })

    it("does not backfill an earlier compatible Build when publishing is enabled", async () => {
      const fixture = await createPrototypeFixture()
      const { repositoryId, id } = fixture.run
      const address = privatePreviewAddress(String(repositoryId), String(id))!
      fixture.packages.set(distArtifactName, privatePreviewPackage(address.mount))

      await expect(fixture.importRun()).resolves.toMatchObject({ dist: "imported" })
      const build = await fixture.findBuild()
      expect(build).toMatchObject({ state: "successful", privatePreviewState: null })

      const { storage: destination, writer } = createPrivatePreviewDestination(repositoryId)
      await expect(fixture.importRun(undefined, writer)).resolves.toMatchObject({
        dist: "unchanged",
      })

      expect(writer.storage.read).not.toHaveBeenCalled()
      expect(writer.storage.write).not.toHaveBeenCalled()
      expect(await fixture.findBuild()).toMatchObject({ id: build.id, privatePreviewState: null })
      await expectPrivatePreviewHidden(build, address)

      const replay = await preparePrivatePreviewReplay(fixture.storage, destination)
      const denied = await replay({ repositoryId, runId: id, buildId: build.id }, repositoryId)
      expect(denied).toMatchObject({ exitCode: 1, stdout: "", blobCalls: 0 })
      expect(denied.stderr).toMatch(/\S/)
      await expect(fixture.findBuild(build.id)).resolves.toEqual(build)
    })

    it("prepares a retained Build only for its exact enabled repository, owning run, Build, and digest", async () => {
      const fixture = await createPrototypeFixture()
      const { repositoryId, id: runId } = fixture.run
      fixture.run.status = "completed"
      fixture.run.conclusion = "success"
      const address = privatePreviewAddress(String(repositoryId), String(runId))!
      const asset = Buffer.from([8, 0, 5])
      const archive = privatePreviewPackage(address.mount, asset)
      const { distDigest } = extractDistPackage(archive)
      fixture.packages.set(distArtifactName, archive)
      await expect(fixture.importRun()).resolves.toMatchObject({ dist: "imported" })

      const before = await fixture.findBuild()
      expect(before).toMatchObject({ state: "successful", privatePreviewState: null, distDigest })
      const target = { repositoryId, runId, buildId: before.id }
      const destination = createImmutableStorage()
      const replay = await preparePrivatePreviewReplay(fixture.storage, destination)
      fixture.packages.clear()
      for (const [requested, enabledFor, digest] of [
        [target, undefined, distDigest],
        [target, repositoryId + 1, distDigest],
        [{ ...target, repositoryId: repositoryId + 1 }, repositoryId, distDigest],
        [{ ...target, runId: runId + 1 }, repositoryId, distDigest],
        [{ ...target, buildId: randomUUID() }, repositoryId, distDigest],
        [target, repositoryId, `sha256:${"f".repeat(64)}`],
      ] as const) {
        await expect(replay(requested, enabledFor, digest)).resolves.toMatchObject({
          exitCode: 1,
          stdout: "",
          blobCalls: 0,
        })
        await expect(fixture.findBuild(before.id)).resolves.toEqual(before)
      }

      const write = destination.write.bind(destination)
      vi.spyOn(destination, "write").mockImplementationOnce(async (key, bytes) => {
        await expect(fixture.findBuild(before.id)).resolves.toMatchObject({
          privatePreviewState: "pending",
        })
        await expectPrivatePreviewHidden(before, address)
        return write(key, bytes)
      })
      const result = await replay(target, repositoryId, distDigest)
      expect(result.exitCode).toBeUndefined()
      expect(JSON.parse(result.stdout)).toEqual({
        buildId: before.id,
        runId: String(runId),
        status: "ready",
      })
      const after = await fixture.findBuild(before.id)
      expect(after).toEqual({ ...before, updatedAt: after.updatedAt, privatePreviewState: "ready" })
      const file = before.artifacts.find(({ path }) => path === "dist/assets/app.bin")!
      const copied = await destination.read(file.storageKey)
      expect(copied.status).toBe("ok")
      if (copied.status === "ok") expect(Buffer.from(copied.bytes)).toEqual(asset)
      await expect(findPrivatePreviewTarget(prisma, address)).resolves.toMatchObject({
        buildId: before.id,
      })
      await expect(replay(target, repositoryId, distDigest)).resolves.toEqual({
        ...result,
        stderr: "",
        blobCalls: 0,
      })
    })

    it("does not prepare a retained Build when its owning run gains another Build during verification", async () => {
      const fixture = await createPrototypeFixture()
      const { repositoryId, id: runId } = fixture.run
      const address = privatePreviewAddress(String(repositoryId), String(runId))!
      const archive = privatePreviewPackage(address.mount)
      const { distDigest } = extractDistPackage(archive)
      fixture.packages.set(distArtifactName, archive)
      await expect(fixture.importRun()).resolves.toMatchObject({ dist: "imported" })
      const before = await fixture.findBuild()
      const destination = createImmutableStorage()
      const replay = await preparePrivatePreviewReplay(fixture.storage, destination)
      const readSource = fixture.storage.read.bind(fixture.storage)
      vi.spyOn(fixture.storage, "read").mockImplementationOnce(async (key) => {
        await prisma.prototype.create({
          data: {
            repositoryId: fixture.repository.id,
            branchName: "proto/competing",
            builds: {
              create: {
                number: 1,
                state: "successful",
                githubWorkflowRunId: BigInt(runId),
                githubWorkflowRunAttempt: 1,
              },
            },
          },
        })
        return readSource(key)
      })

      const skipped = await replay(
        { repositoryId, runId, buildId: before.id },
        repositoryId,
        distDigest,
      )

      expect(skipped).toMatchObject({ exitCode: 1, stdout: "" })
      expect(skipped.stderr).not.toContain("database-error")
      await expect(fixture.findBuild(before.id)).resolves.toEqual(before)
      for (const { storageKey } of before.artifacts) {
        await expect(destination.read(storageKey)).resolves.toEqual({ status: "not-found" })
      }
    })

    it("keeps a prepared Build pending without overwriting a conflicting preview object", async () => {
      const fixture = await createPrototypeFixture()
      const { repositoryId, id: runId } = fixture.run
      const address = privatePreviewAddress(String(repositoryId), String(runId))!
      const archive = privatePreviewPackage(address.mount)
      const { distDigest } = extractDistPackage(archive)
      fixture.packages.set(distArtifactName, archive)
      await expect(fixture.importRun()).resolves.toMatchObject({ dist: "imported" })
      const before = await fixture.findBuild()
      const { storageKey } = before.artifacts.find(({ path }) => path === "dist/assets/app.bin")!
      const destination = createImmutableStorage()
      const collision = Buffer.from([0, 80, 9])
      await destination.write(storageKey, collision)
      const replay = await preparePrivatePreviewReplay(fixture.storage, destination)

      const failed = await replay(
        { repositoryId, runId, buildId: before.id },
        repositoryId,
        distDigest,
      )

      expect(failed).toMatchObject({ exitCode: 1, stdout: "" })
      const warning = failed.stderr.split("\n").find((line) => line.startsWith("{"))
      expect(JSON.parse(warning ?? "null")).toMatchObject({
        stage: "copy-files",
        reason: "destination-conflict",
      })
      await expect(destination.read(storageKey)).resolves.toEqual({
        status: "ok",
        bytes: collision,
      })
      await expect(fixture.findBuild(before.id)).resolves.toMatchObject({
        privatePreviewState: "pending",
      })
      await expectPrivatePreviewHidden(before, address)
    })
  })

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
      expect(await recovery()).toEqual({ awaiting: [job], discovered: [job] })

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
      expect(await recovery()).toEqual({ awaiting: [job], discovered: [job] })

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
    const { repositoryId, id } = fixture.run
    const address = privatePreviewAddress(String(repositoryId), String(id))!
    const { writer } = createPrivatePreviewDestination(repositoryId)
    fixture.packages.set(distArtifactName, privatePreviewPackage(address.mount))

    await expect(fixture.importRun(undefined, writer)).resolves.toMatchObject({ dist: "imported" })

    const build = await fixture.findBuild()
    expect(build).toMatchObject({
      state: "successful",
      privatePreviewState: null,
      prototype: { replica: true, registeredAt: null },
    })
    expect(writer.storage.read).not.toHaveBeenCalled()
    expect(writer.storage.write).not.toHaveBeenCalled()
    await expect(findPrivatePreviewTarget(prisma, address)).resolves.toBeNull()
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

  it("settles a deselected Build awaiting its author without changing its import or owner", async () => {
    const fixture = await createFixture()
    fixture.run.status = "completed"
    fixture.run.conclusion = "success"
    fixture.packages.set(distArtifactName, distPackage())
    fixture.client.getCommitAuthor.mockRejectedValue(new GitHubCommitLookupError(503))
    await expect(fixture.importRun()).rejects.toThrow("GitHub commit lookup failed (HTTP 503).")
    const before = await fixture.findBuild()
    const createdAfter = new Date(before.createdAt.getTime() - 1)
    expect(await listGitHubBuildsAwaitingImport(prisma, { createdAfter })).toHaveLength(1)
    fixture.workflowPaths.splice(0)

    await expect(fixture.importRun()).resolves.toEqual({ dist: "ignored", screenshots: "absent" })

    const settled = await fixture.findBuild()
    expect(settled).toEqual({
      ...before,
      updatedAt: settled.updatedAt,
      workflowCompletedAt: fixture.run.updatedAt,
    })
    expect(await listGitHubBuildsAwaitingImport(prisma, { createdAfter })).toEqual([])
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
