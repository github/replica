import { createHash, generateKeyPairSync, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import pg from "pg"
import pino from "pino"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../create-app"
import { syncGitHubInstallationRepositories } from "../../../domains/admission/sync-github-installation-repositories"
import { createGitHubAuthenticationContext } from "../../../domains/authentication/create-github-authentication-context"
import { activateGitHubRepositoryScoping } from "../../../domains/identity/activate-github-repository-scoping"
import { createReviewCommentService } from "../../../domains/review-comments/create-review-comment-service"
import { listInstallationRepositories } from "../../../integrations/github/list-installation-repositories"
import { prisma } from "../../../integrations/prisma"
import { findRepositoryIndex } from "../../../repositories/prototype-index/find-repository-index"
import type { runApi } from "../../../run-api"
import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { createAuthenticationRouteDependencies } from "../auth/create-authentication-route-dependencies"
import type { AuthenticationRouteDependencies } from "../auth/types"
import { createLearningsRouteDependencies } from "../learnings/create-learnings-route-dependencies"
import type { LearningsRouteDependencies } from "../learnings/types"
import { createProductRouteDependencies } from "../product/create-product-route-dependencies"
import type { ProductRouteDependencies } from "../product/types"

async function withServer(
  restore: AuthenticationRouteDependencies["currentSession"]["restore"],
  product: ProductRouteDependencies,
  operation: (baseUrl: string) => Promise<void>,
  learnings?: LearningsRouteDependencies,
) {
  const authentication: AuthenticationRouteDependencies = {
    currentSession: { restore },
    signOut: { applicationOrigin: "http://127.0.0.1:5173", secureCookie: false, end: vi.fn() },
  }
  const server = createServer(createApp({ authentication, learnings, product }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe("real product index", () => {
  it("uses each current Build or the latest chronological Build", async () => {
    const repositoryId = randomUUID()
    const pointerPrototypeId = randomUUID()
    const fallbackPrototypeId = randomUUID()
    const noBuildPrototypeId = randomUUID()
    const currentBuildId = randomUUID()
    const pointerFallbackBuildId = randomUUID()
    const createdAtFallbackBuildId = randomUUID()
    const lowerNumberBuildId = randomUUID()
    const latestFallbackBuildId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.prototype.createMany({
      data: [
        {
          id: pointerPrototypeId,
          repositoryId,
          branchName: "prototype/current-build",
          name: "Current Build",
          registeredAt: new Date("2026-10-03T00:00:00Z"),
        },
        {
          id: fallbackPrototypeId,
          repositoryId,
          branchName: "prototype/latest-build",
          name: "Latest Build",
          registeredAt: new Date("2026-10-01T00:00:00Z"),
        },
        {
          id: noBuildPrototypeId,
          repositoryId,
          branchName: "prototype/no-build",
          name: "No Build",
          registeredAt: new Date("2026-09-30T00:00:00Z"),
        },
      ],
    })

    async function createBuild(
      id: string,
      prototypeId: string,
      number: number,
      state: "failed" | "queued" | "running" | "successful" | "superseded",
      workflowCreatedAt: string | null,
      createdAt: string,
    ) {
      await prisma.$executeRaw`
        INSERT INTO "builds"
          ("id", "prototype_id", "number", "state", "workflow_created_at", "created_at")
        VALUES (
          ${id}::uuid,
          ${prototypeId}::uuid,
          ${number},
          ${state}::"BuildState",
          ${workflowCreatedAt}::timestamptz,
          ${createdAt}::timestamptz
        )
      `
    }

    await createBuild(
      currentBuildId,
      pointerPrototypeId,
      2,
      "failed",
      "2026-10-02T00:00:00Z",
      "2026-10-02T00:00:00Z",
    )
    await createBuild(
      pointerFallbackBuildId,
      pointerPrototypeId,
      9,
      "successful",
      "2026-10-08T00:00:00Z",
      "2026-10-08T00:00:00Z",
    )
    await createBuild(
      createdAtFallbackBuildId,
      fallbackPrototypeId,
      100,
      "failed",
      null,
      "2026-10-07T00:00:00Z",
    )
    await createBuild(
      lowerNumberBuildId,
      fallbackPrototypeId,
      6,
      "queued",
      "2026-10-08T00:00:00Z",
      "2026-10-03T00:00:00Z",
    )
    await createBuild(
      latestFallbackBuildId,
      fallbackPrototypeId,
      7,
      "running",
      "2026-10-08T00:00:00Z",
      "2026-10-02T00:00:00Z",
    )
    await prisma.$executeRaw`
      UPDATE "prototypes"
      SET "current_build_id" = ${currentBuildId}::uuid
      WHERE "id" = ${pointerPrototypeId}::uuid
    `

    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })
    await withServer(restore, createProductRouteDependencies(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}`, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(200)
      const index = (await response.json()) as {
        prototypes: {
          id: string
          latestBuild: { number: number; state: string } | null
          builds: unknown[]
        }[]
      }

      expect(index.prototypes).toEqual([
        expect.objectContaining({
          id: pointerPrototypeId,
          latestBuild: { number: 2, state: "failed" },
          builds: [],
        }),
        expect.objectContaining({
          id: fallbackPrototypeId,
          latestBuild: { number: 7, state: "running" },
          builds: [],
        }),
        expect.objectContaining({
          id: noBuildPrototypeId,
          latestBuild: null,
          builds: [],
        }),
      ])
    })
  })

  it("serves the gallery screenshot of the newest eligible Build from Hub without a preview origin", async () => {
    const applicationOrigin = "http://127.0.0.1:5173"
    const { id: repositoryId } = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const { id: otherRepositoryId } = await prisma.repository.create({
      data: { nameWithOwner: "team/other", defaultBranch: "main" },
    })
    const registeredAt = new Date("2026-10-01")
    const entry = { kind: "dist", path: "dist/index.html" } as const
    const desktop = { kind: "screenshot", path: "screenshots/desktop.png" } as const
    function artifacts(...files: (typeof entry | typeof desktop)[]) {
      return {
        create: files.map((file) => ({ ...file, storageKey: randomUUID(), byteLength: 80 })),
      }
    }

    const reviewBuildId = randomUUID()
    const { id: prototypeId } = await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/welcome",
        name: "Welcome",
        registeredAt,
        builds: {
          create: [
            {
              number: 9,
              state: "successful",
              workflowCreatedAt: new Date("2026-10-02"),
              createdAt: new Date("2026-10-07"),
              artifacts: artifacts(entry, desktop),
            },
            {
              id: reviewBuildId,
              number: 2,
              state: "successful",
              createdAt: new Date("2026-10-03"),
              artifacts: artifacts(entry, desktop),
            },
            {
              number: 3,
              state: "successful",
              createdAt: new Date("2026-10-04"),
              artifacts: artifacts(entry),
            },
            {
              number: 4,
              state: "successful",
              createdAt: new Date("2026-10-05"),
              artifacts: artifacts(desktop),
            },
            {
              number: 5,
              state: "failed",
              createdAt: new Date("2026-10-06"),
              artifacts: artifacts(entry, desktop),
            },
          ],
        },
      },
    })
    const { id: previewOnlyPrototypeId } = await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/preview-only",
        name: "Preview only",
        registeredAt,
        builds: { create: { number: 1, state: "successful", artifacts: artifacts(entry) } },
      },
    })

    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })
    const desktopArtifact = await prisma.buildArtifact.findFirstOrThrow({
      where: { buildId: reviewBuildId, path: desktop.path },
    })
    const screenshotBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const artifactStorage = {
      isReady: vi.fn(),
      read: vi.fn((key: string) =>
        Promise.resolve(
          key === desktopArtifact.storageKey
            ? { status: "ok" as const, bytes: screenshotBytes }
            : { status: "not-found" as const },
        ),
      ),
      write: vi.fn(),
      delete: vi.fn(),
    }
    const product = createProductRouteDependencies({ applicationOrigin, artifactStorage })
    await withServer(restore, product, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}`, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(200)
      const index = (await response.json()) as {
        prototypes: {
          id: string
          reviewBuild: { number: number; desktopScreenshotUrl: string | null } | null
        }[]
      }
      const prototype = index.prototypes.find(({ id }) => id === prototypeId)
      expect(prototype).toMatchObject({
        latestBuild: { number: 5, state: "failed" },
        reviewBuild: { number: 2 },
        builds: [],
      })
      const desktopScreenshotUrl = prototype?.reviewBuild?.desktopScreenshotUrl
      expect(desktopScreenshotUrl).toBeTypeOf("string")
      expect(desktopScreenshotUrl).toBe(
        `${applicationOrigin}/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds/2/screenshots/desktop`,
      )
      const screenshotUrl = new URL(desktopScreenshotUrl ?? "")
      const screenshot = await fetch(`${baseUrl}${screenshotUrl.pathname}`, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(screenshot.status).toBe(200)
      expect(new Uint8Array(await screenshot.arrayBuffer())).toEqual(screenshotBytes)

      const otherRepository = await fetch(`${baseUrl}/api/repositories/${otherRepositoryId}`, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(otherRepository.status).toBe(200)
      artifactStorage.read.mockClear()
      const crossRepositoryScreenshot = await fetch(
        `${baseUrl}/api/repositories/${otherRepositoryId}/prototypes/${prototypeId}/builds/2/screenshots/desktop`,
        { headers: { cookie: "hub_session=member-session" } },
      )
      expect(crossRepositoryScreenshot.status).toBe(404)
      const crossPrototypeScreenshot = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/prototypes/${previewOnlyPrototypeId}/builds/2/screenshots/desktop`,
        { headers: { cookie: "hub_session=member-session" } },
      )
      expect(crossPrototypeScreenshot.status).toBe(404)
      expect(artifactStorage.read).not.toHaveBeenCalledWith(desktopArtifact.storageKey)

      expect(index.prototypes.find(({ id }) => id === previewOnlyPrototypeId)).toMatchObject({
        reviewBuild: null,
        builds: [],
      })
    })
  })

  it("refuses Hub-origin screenshots beyond the shared preview allowance and releases finished reads", async () => {
    const mebibyte = 1024 * 1024
    const { id: repositoryId } = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const oversizedKey = randomUUID()
    const largeKey = randomUUID()
    const { id: prototypeId } = await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/welcome",
        name: "Welcome",
        registeredAt: new Date("2026-10-01"),
        builds: {
          create: [1, 2].map((number) => ({
            number,
            state: "successful" as const,
            artifacts: {
              create: {
                kind: "screenshot" as const,
                path: "screenshots/desktop.png",
                storageKey: number === 1 ? oversizedKey : largeKey,
                byteLength: number === 1 ? 100 * mebibyte + 1 : 60 * mebibyte,
              },
            },
          })),
        },
      },
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })
    const artifactStorage = {
      isReady: vi.fn(),
      read: vi.fn(() =>
        Promise.resolve({ status: "ok" as const, bytes: new Uint8Array([0x89, 0x50]) }),
      ),
      write: vi.fn(),
      delete: vi.fn(),
    }
    const product = createProductRouteDependencies({
      applicationOrigin: "http://127.0.0.1:5173",
      artifactStorage,
    })

    await withServer(restore, product, async (baseUrl) => {
      function screenshotUrl(buildNumber: number) {
        return `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds/${buildNumber}/screenshots/desktop`
      }
      const member = { headers: { cookie: "hub_session=member-session" } }

      const oversized = await fetch(screenshotUrl(1), member)
      expect(oversized.status).toBe(503)
      expect(artifactStorage.read).not.toHaveBeenCalledWith(oversizedKey)

      for (let request = 0; request < 2; request++) {
        const large = await fetch(screenshotUrl(2), member)
        expect(large.status).toBe(200)
        await large.arrayBuffer()
      }
    })
  })

  it("reports stored screenshots it cannot serve within their reservation as unavailable", async () => {
    const { id: repositoryId } = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const { id: prototypeId } = await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/welcome",
        name: "Welcome",
        registeredAt: new Date("2026-10-01"),
        builds: {
          create: {
            number: 1,
            state: "successful",
            artifacts: {
              create: {
                kind: "screenshot",
                path: "screenshots/desktop.png",
                storageKey: randomUUID(),
                byteLength: 2,
              },
            },
          },
        },
      },
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })
    const artifactStorage = {
      isReady: vi.fn(),
      read: vi
        .fn()
        .mockResolvedValueOnce({ status: "ok", bytes: new Uint8Array([0x89, 0x50, 0x4e]) })
        .mockResolvedValueOnce({ status: "too-large" })
        .mockResolvedValueOnce({ status: "invalid-key" }),
      write: vi.fn(),
      delete: vi.fn(),
    }
    const product = createProductRouteDependencies({
      applicationOrigin: "http://127.0.0.1:5173",
      artifactStorage,
    })

    await withServer(restore, product, async (baseUrl) => {
      const screenshotUrl = `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds/1/screenshots/desktop`
      const member = { headers: { cookie: "hub_session=member-session" } }

      const statuses = []
      for (let request = 0; request < 3; request++) {
        statuses.push((await fetch(screenshotUrl, member)).status)
      }

      expect(statuses).toEqual([503, 503, 503])
      expect(artifactStorage.read).toHaveBeenCalledTimes(3)
    })
  })

  it("keeps a screenshot-less Build reviewable when Hub can open its hosted preview", async () => {
    const applicationOrigin = "http://127.0.0.1:5173"
    const { id: repositoryId } = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    function artifacts(...paths: string[]) {
      return {
        create: paths.map((path) => ({
          kind: path.startsWith("dist/") ? ("dist" as const) : ("screenshot" as const),
          path,
          storageKey: randomUUID(),
          byteLength: 80,
        })),
      }
    }
    const { id: screenshotPrototypeId } = await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/welcome",
        name: "Welcome",
        registeredAt: new Date("2026-10-01"),
        builds: {
          create: {
            number: 2,
            state: "successful",
            artifacts: artifacts("dist/index.html", "screenshots/desktop.png"),
          },
        },
      },
    })
    const { id: previewOnlyPrototypeId } = await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/preview-only",
        name: "Preview only",
        registeredAt: new Date("2026-10-01"),
        builds: {
          create: { number: 1, state: "successful", artifacts: artifacts("dist/index.html") },
        },
      },
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })
    const product = createProductRouteDependencies({
      applicationOrigin,
      previewBaseOrigin: "http://preview.localhost:3001",
      artifactStorage: { isReady: vi.fn(), read: vi.fn(), write: vi.fn(), delete: vi.fn() },
    })

    await withServer(restore, product, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}`, {
        headers: { cookie: "hub_session=member-session" },
      })

      expect(response.status).toBe(200)
      const index = (await response.json()) as { prototypes: { id: string }[] }
      expect(index.prototypes.find(({ id }) => id === screenshotPrototypeId)).toMatchObject({
        reviewBuild: {
          number: 2,
          desktopScreenshotUrl: `${applicationOrigin}/api/repositories/${repositoryId}/prototypes/${screenshotPrototypeId}/builds/2/screenshots/desktop`,
        },
      })
      expect(index.prototypes.find(({ id }) => id === previewOnlyPrototypeId)).toMatchObject({
        reviewBuild: { number: 1, desktopScreenshotUrl: null },
      })
    })
  })

  it("lists active repositories and only reviewable prototypes for GitHub and Entra members", async () => {
    const repositoryId = randomUUID()
    const anotherRepositoryId = randomUUID()
    const removedRepositoryId = randomUUID()
    const authorId = randomUUID()
    const olderId = "10000000-0000-4000-8000-000000000001"
    const tiedId = "10000000-0000-4000-8000-000000000002"
    const newestId = "10000000-0000-4000-8000-000000000003"
    const replicaNamedId = "10000000-0000-4000-8000-000000000004"
    const registeredAt = new Date("2026-10-01T12:00:00Z")
    const olderPrototypes = [
      {
        id: randomUUID(),
        repositoryId,
        branchName: "main",
        name: "Non-default main",
        registeredAt: new Date("2026-09-01T00:00:00Z"),
      },
      ...Array.from({ length: 22 }, (_, index) => ({
        id: randomUUID(),
        repositoryId,
        branchName: `prototype/older-${index}`,
        name: `Older ${index}`,
        registeredAt: new Date("2026-09-01T00:00:00Z"),
      })),
    ]
    await prisma.repository.createMany({
      data: [
        { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "trunk" },
        { id: anotherRepositoryId, nameWithOwner: "team/other", defaultBranch: "main" },
        {
          id: removedRepositoryId,
          nameWithOwner: "team/removed",
          defaultBranch: "main",
          removedAt: new Date("2026-11-01T00:00:00Z"),
        },
      ],
    })
    await prisma.user.create({ data: { id: authorId } })
    await prisma.userProfile.create({
      data: { userId: authorId, provider: "github", login: "mona", name: "Mona" },
    })
    await prisma.prototype.createMany({
      data: [
        {
          id: olderId,
          repositoryId,
          authorId,
          branchName: "prototype/older",
          name: "Older",
          registeredAt,
          createdAt: new Date("2026-11-01T00:00:00Z"),
        },
        {
          id: tiedId,
          repositoryId,
          branchName: "prototype/unattributed",
          name: "Unattributed",
          registeredAt,
          createdAt: new Date("2026-09-01T00:00:00Z"),
        },
        {
          id: newestId,
          repositoryId,
          authorId,
          branchName: "prototype/newest",
          name: "Newest",
          registeredAt: new Date("2026-10-02T12:00:00Z"),
          createdAt: new Date("2026-08-01T00:00:00Z"),
        },
        { repositoryId, branchName: "prototype/draft", name: "Draft" },
        {
          repositoryId,
          branchName: "prototype/deleted",
          name: "Deleted",
          registeredAt,
          branchDeletedAt: new Date("2026-10-03T00:00:00Z"),
        },
        { repositoryId, branchName: "trunk", name: "Default branch", registeredAt },
        {
          id: replicaNamedId,
          repositoryId,
          branchName: "replica/default-branch",
          name: "A reviewable branch",
          registeredAt,
        },
        {
          repositoryId,
          branchName: "replica/install-workflow",
          name: "Install workflow",
          registeredAt,
        },
        { repositoryId, branchName: "replica/internal", replica: true },
        {
          repositoryId: anotherRepositoryId,
          branchName: "prototype/other",
          name: "Other repository",
          registeredAt,
        },
        ...olderPrototypes,
      ],
    })

    const githubSession = {
      membershipId: randomUUID(),
      userId: authorId,
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER" as const,
    }
    const entraSession = {
      membershipId: randomUUID(),
      userId: (await prisma.user.create({ data: {} })).id,
      provider: "entra",
      sessionProvider: "entra",
      login: "member",
      name: "Member",
      role: "MEMBER" as const,
    }
    const githubToken = "github-session"
    const entraToken = "entra-session"
    function hash(value: string) {
      return createHash("sha256").update(value).digest("hex")
    }
    const restore = vi.fn((digest: string) => {
      if (digest === hash(githubToken)) return Promise.resolve(githubSession)
      if (digest === hash(entraToken)) return Promise.resolve(entraSession)
      return Promise.resolve(null)
    })
    await withServer(restore, createProductRouteDependencies(), async (baseUrl) => {
      for (const [token, session] of [
        [githubToken, githubSession],
        [entraToken, entraSession],
      ] as const) {
        const headers = { cookie: `hub_session=${token}` }
        const workspaceResponse = await fetch(`${baseUrl}/api/workspace`, { headers })
        expect(workspaceResponse.status).toBe(200)
        expect(workspaceResponse.headers.get("cache-control")).toBe("no-store")
        const workspace = (await workspaceResponse.json()) as {
          viewer: { id: string; login: string }
          repositories: { id: string }[]
          capabilities: {
            createPrototypes: boolean
            reviewPrototypes: boolean
            manageSharing: boolean
          }
        }
        expect(workspace.viewer).toMatchObject({ id: session.userId, login: session.login })
        expect(workspace.repositories.map(({ id }) => id).sort()).toEqual(
          [repositoryId, anotherRepositoryId].sort(),
        )
        expect(workspace.capabilities).toMatchObject({
          createPrototypes: false,
          reviewPrototypes: false,
          manageSharing: false,
        })

        const indexResponse = await fetch(`${baseUrl}/api/repositories/${repositoryId}`, {
          headers,
        })
        expect(indexResponse.status).toBe(200)
        expect(indexResponse.headers.get("cache-control")).toBe("no-store")
        const index = (await indexResponse.json()) as {
          repository: { id: string; nameWithOwner: string }
          prototypes: {
            id: string
            authorLogin: string | null
            canEdit: boolean
            builds: unknown[]
          }[]
          pagination: { page: number; pageSize: number; totalCount: number; pageCount: number }
          authors: { id: string; login: string }[]
        }
        expect(index.repository).toMatchObject({ id: repositoryId, nameWithOwner: "team/design" })
        expect(index.pagination).toEqual({ page: 1, pageSize: 24, totalCount: 27, pageCount: 2 })
        expect(index.prototypes.map(({ id }) => id)).toEqual([
          newestId,
          replicaNamedId,
          tiedId,
          olderId,
          ...olderPrototypes
            .map(({ id }) => id)
            .sort()
            .reverse()
            .slice(0, 20),
        ])
        expect(
          index.prototypes.every(({ canEdit, builds }) => !canEdit && builds.length === 0),
        ).toBe(true)
        expect(index.prototypes.find(({ id }) => id === tiedId)?.authorLogin ?? null).toBeNull()
        expect(index.authors).toContainEqual(
          expect.objectContaining({ id: authorId, login: "mona" }),
        )
        expect(index.authors).toHaveLength(1)
        const secondPage = await fetch(`${baseUrl}/api/repositories/${repositoryId}?page=2`, {
          headers,
        })
        expect(secondPage.status).toBe(200)
        const second = (await secondPage.json()) as typeof index
        expect(second.pagination).toMatchObject({ page: 2, totalCount: 27, pageCount: 2 })
        expect(second.prototypes.map(({ id }) => id)).toEqual(
          olderPrototypes
            .map(({ id }) => id)
            .sort()
            .reverse()
            .slice(20),
        )
        const anotherResponse = await fetch(`${baseUrl}/api/repositories/${anotherRepositoryId}`, {
          headers,
        })
        expect(anotherResponse.status).toBe(200)
      }

      expect(restore).toHaveBeenCalledWith(hash(githubToken))
      expect(restore).toHaveBeenCalledWith(hash(entraToken))
    })
  })

  it("searches, filters by user, and pages through users with prototypes", async () => {
    const repositoryId = randomUUID()
    const viewerId = randomUUID()
    const monaId = randomUUID()
    const hiddenAuthorId = randomUUID()
    const otherIds = Array.from({ length: 20 }, () => randomUUID())
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.user.createMany({
      data: [viewerId, monaId, hiddenAuthorId, ...otherIds].map((id) => ({ id })),
    })
    await prisma.userProfile.createMany({
      data: [
        { userId: viewerId, provider: "entra", login: "viewer@example.test", name: "Viewer" },
        { userId: monaId, provider: "github", login: "mona", name: "Mona Lisa" },
        { userId: hiddenAuthorId, provider: "github", login: "hidden", name: "Hidden" },
        ...otherIds.map((userId, index) => ({
          userId,
          provider: "github",
          login: `user-${String(index).padStart(2, "0")}`,
        })),
      ],
    })
    const registeredAt = new Date("2026-10-01T00:00:00Z")
    const viewerPrototypeId = randomUUID()
    const monaPrototypeId = randomUUID()
    await prisma.prototype.createMany({
      data: [
        {
          id: viewerPrototypeId,
          repositoryId,
          authorId: viewerId,
          branchName: "prototype/checkout",
          name: "Checkout",
          description: "Save 100% faster",
          registeredAt,
        },
        {
          id: monaPrototypeId,
          repositoryId,
          authorId: monaId,
          branchName: "prototype/onboarding",
          name: "Onboarding",
          registeredAt,
        },
        {
          repositoryId,
          authorId: hiddenAuthorId,
          branchName: "prototype/draft",
          name: "Draft",
        },
        ...otherIds.map((authorId, index) => ({
          repositoryId,
          authorId,
          branchName: `prototype/other-${index}`,
          name: `Other ${index}`,
          registeredAt,
        })),
      ],
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: viewerId,
      provider: "entra",
      sessionProvider: "entra",
      login: "viewer@example.test",
      name: "Viewer",
      role: "MEMBER",
    })
    const headers = { cookie: "hub_session=member-session" }

    await withServer(restore, createProductRouteDependencies(), async (baseUrl) => {
      async function index(query: string) {
        const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}?${query}`, {
          headers,
        })
        expect(response.status).toBe(200)
        return (await response.json()) as {
          prototypes: { id: string }[]
          pagination: { page: number; totalCount: number; pageCount: number }
          authors: { id: string }[]
        }
      }
      async function authors(query: string) {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/authors?${query}`,
          { headers },
        )
        expect(response.status).toBe(200)
        return (await response.json()) as {
          authors: { id: string; login: string }[]
          nextCursor: string | null
        }
      }

      for (const query of ["q=%20ONBOARD%20", "q=lisa", "q=prototype%2Fonb"]) {
        expect((await index(query)).prototypes.map(({ id }) => id)).toEqual([monaPrototypeId])
      }
      expect((await index("q=100%25")).prototypes.map(({ id }) => id)).toEqual([viewerPrototypeId])
      expect((await index("q=1_0")).prototypes).toEqual([])
      expect((await index("author=me")).prototypes.map(({ id }) => id)).toEqual([viewerPrototypeId])
      const monaIndex = await index(`author=${monaId}&page=9`)
      expect(monaIndex.prototypes.map(({ id }) => id)).toEqual([monaPrototypeId])
      expect(monaIndex.pagination).toMatchObject({ page: 1, totalCount: 1, pageCount: 1 })
      const noMatches = await index(`author=${monaId}&q=checkout`)
      expect(noMatches.prototypes).toEqual([])
      expect(noMatches.authors.map(({ id }) => id)).toEqual([monaId])

      for (const query of ["page=0", "page=1.5", "author=42", "q[]=a", "view=list"]) {
        const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}?${query}`, {
          headers,
        })
        expect(response.status).toBe(400)
      }

      const firstAuthors = await authors("")
      expect(firstAuthors.authors.map(({ login }) => login)).toEqual([
        "mona",
        ...otherIds.slice(0, 19).map((_, index) => `user-${String(index).padStart(2, "0")}`),
      ])
      expect(firstAuthors.nextCursor).not.toBeNull()
      const nextAuthors = await authors(`cursor=${firstAuthors.nextCursor}`)
      expect(nextAuthors).toEqual({
        authors: [expect.objectContaining({ id: otherIds[19], login: "user-19" })],
        nextCursor: null,
      })
      expect((await authors("q=LISA")).authors.map(({ id }) => id)).toEqual([monaId])

      const badCursor = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/authors?cursor=not-a-cursor`,
        { headers },
      )
      expect(badCursor.status).toBe(400)
    })
  })

  it("does not disclose product data without a current session", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "private/design", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/secret",
        name: "Private prototype",
        registeredAt: new Date("2026-10-01T00:00:00Z"),
      },
    })
    const restore = vi.fn().mockResolvedValue(null)
    const headerSets: Record<string, string>[] = [{}, { cookie: "hub_session=expired-session" }]

    await withServer(restore, createProductRouteDependencies(), async (baseUrl) => {
      for (const path of [
        "/api/workspace",
        `/api/repositories/${repositoryId}`,
        `/api/repositories/${repositoryId}/authors`,
      ]) {
        for (const headers of headerSets) {
          const response = await fetch(`${baseUrl}${path}`, { headers })
          expect(response.status).toBe(401)
          const body = await response.text()
          expect(body).not.toContain("private/design")
          expect(body).not.toContain("Private prototype")
        }
      }
      expect(restore).toHaveBeenCalledWith(
        createHash("sha256").update("expired-session").digest("hex"),
      )
    })
  })

  it("does not return data when the session is revoked during a product read", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "private/design", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/secret",
        name: "Private prototype",
        registeredAt: new Date("2026-10-01T00:00:00Z"),
      },
    })
    const activeSession = {
      membershipId: randomUUID(),
      userId: (await prisma.user.create({ data: {} })).id,
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER" as const,
    }
    let currentSession: typeof activeSession | null = activeSession
    const restore = vi.fn(() => Promise.resolve(currentSession))
    const product = createProductRouteDependencies()
    const listRepositories = product.listRepositories.bind(product)
    const findRepositoryIndex = product.findRepositoryIndex.bind(product)
    const list = vi.spyOn(product, "listRepositories").mockImplementation(async (viewer) => {
      const repositories = await listRepositories(viewer)
      currentSession = null
      return repositories
    })
    const findRepositoryAuthors = product.findRepositoryAuthors.bind(product)
    const find = vi
      .spyOn(product, "findRepositoryIndex")
      .mockImplementation(async (viewer, id, filters) => {
        const index = await findRepositoryIndex(viewer, id, filters)
        currentSession = null
        return index
      })
    const findAuthors = vi
      .spyOn(product, "findRepositoryAuthors")
      .mockImplementation(async (viewer, id, filters) => {
        const authors = await findRepositoryAuthors(viewer, id, filters)
        currentSession = null
        return authors
      })

    await withServer(restore, product, async (baseUrl) => {
      for (const path of [
        "/api/workspace",
        `/api/repositories/${repositoryId}`,
        `/api/repositories/${repositoryId}/authors`,
      ]) {
        currentSession = activeSession
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { cookie: "hub_session=member-session" },
        })

        expect(response.status).toBe(401)
        const body = await response.text()
        expect(body).not.toContain("private/design")
        expect(body).not.toContain("Private prototype")
      }
      expect(list).toHaveBeenCalledOnce()
      expect(find).toHaveBeenCalledOnce()
      expect(findAuthors).toHaveBeenCalledOnce()
    })
  })

  it("uses the current role after reading the workspace", async () => {
    const session = {
      membershipId: randomUUID(),
      userId: (await prisma.user.create({ data: {} })).id,
      provider: "entra",
      sessionProvider: "entra",
      login: "member",
      name: "Member",
      role: "MEMBER" as "MEMBER" | "ADMINISTRATOR",
    }
    let currentSession = session
    let roleAfterRead: "MEMBER" | "ADMINISTRATOR" = "MEMBER"
    const restore = vi.fn(() => Promise.resolve(currentSession))
    const product = createProductRouteDependencies()
    const listRepositories = product.listRepositories.bind(product)
    vi.spyOn(product, "listRepositories").mockImplementation(async (viewer) => {
      const repositories = await listRepositories(viewer)
      currentSession = { ...currentSession, role: roleAfterRead }
      return repositories
    })

    await withServer(restore, product, async (baseUrl) => {
      for (const [before, after] of [
        ["MEMBER", "ADMINISTRATOR"],
        ["ADMINISTRATOR", "MEMBER"],
      ] as const) {
        currentSession = { ...session, role: before }
        roleAfterRead = after
        const response = await fetch(`${baseUrl}/api/workspace`, {
          headers: { cookie: "hub_session=member-session" },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          capabilities: { administerHub: after === "ADMINISTRATOR" },
        })
      }
    })
  })

  it("hides retained legacy history from every viewer when GitHub scoping is enabled", async () => {
    const user = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    const legacy = await prisma.repository.create({
      data: { nameWithOwner: "team/reused", defaultBranch: "main" },
    })
    const current = await prisma.repository.create({
      data: { githubRepositoryId: 1001, nameWithOwner: "team/reused", defaultBranch: "main" },
    })
    const other = await prisma.repository.create({
      data: { githubRepositoryId: 1002, nameWithOwner: "team/other", defaultBranch: "main" },
    })
    const legacyPrototype = await prisma.prototype.create({
      data: {
        repositoryId: legacy.id,
        branchName: "prototype/legacy",
        name: "Legacy history",
        registeredAt: new Date("2026-01-01T00:00:00Z"),
      },
    })
    const build = await prisma.build.create({
      data: {
        prototypeId: legacyPrototype.id,
        number: 1,
        state: "successful",
        commitSha: "a".repeat(40),
      },
    })
    await prisma.prototype.update({
      where: { id: legacyPrototype.id },
      data: { currentBuildId: build.id },
    })
    const currentPrototype = await prisma.prototype.create({
      data: {
        repositoryId: current.id,
        branchName: "prototype/current",
        name: "Current prototype",
        registeredAt: new Date("2026-01-01T00:00:00Z"),
      },
    })
    await prisma.repositoryAccessGrant.createMany({
      data: [legacy.id, current.id].map((repositoryId) => ({
        membershipId: membership.id,
        repositoryId,
        observedAt: new Date(),
      })),
    })
    const retainedHistory = await prisma.repository.findUniqueOrThrow({
      where: { id: legacy.id },
      include: { prototypes: { include: { builds: true } } },
    })
    const githubMember = {
      membershipId: membership.id,
      userId: user.id,
      provider: "entra",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER" as const,
    }
    const restore = vi.fn()
    const headers = { cookie: "hub_session=viewer-session" }
    const legacyPath = `/api/repositories/${legacy.id}`
    const legacyPrototypePath = `${legacyPath}/prototypes/${legacyPrototype.id}`

    await withServer(
      restore,
      createProductRouteDependencies({ scopeGitHubMembers: true }),
      async (baseUrl) => {
        for (const { viewer, visible, canReadOther } of [
          {
            viewer: { ...githubMember, role: "ADMINISTRATOR" as const },
            visible: [current.id, other.id],
            canReadOther: true,
          },
          {
            viewer: { ...githubMember, provider: "github", sessionProvider: "entra" },
            visible: [current.id, other.id],
            canReadOther: true,
          },
          { viewer: githubMember, visible: [current.id], canReadOther: false },
        ]) {
          restore.mockResolvedValue(viewer)
          const workspaceResponse = await fetch(`${baseUrl}/api/workspace`, { headers })
          expect(workspaceResponse.status).toBe(200)
          const workspace = (await workspaceResponse.json()) as { repositories: { id: string }[] }
          expect(workspace.repositories.map(({ id }) => id).sort()).toEqual(visible.sort())

          for (const path of [
            legacyPath,
            `${legacyPath}/authors`,
            `${legacyPrototypePath}?view=minimized`,
            `${legacyPrototypePath}/builds`,
          ]) {
            const response = await fetch(`${baseUrl}${path}`, { headers })
            expect(response.status).toBe(404)
            expect(await response.text()).not.toContain("Legacy history")
          }
          const currentResponse = await fetch(`${baseUrl}/api/repositories/${current.id}`, {
            headers,
          })
          expect(currentResponse.status).toBe(200)
          const currentIndex = (await currentResponse.json()) as { prototypes: { id: string }[] }
          expect(currentIndex.prototypes.map(({ id }) => id)).toEqual([currentPrototype.id])
          const otherResponse = await fetch(`${baseUrl}/api/repositories/${other.id}`, { headers })
          expect(otherResponse.status).toBe(canReadOther ? 200 : 404)
        }
      },
    )

    restore.mockResolvedValue(githubMember)
    await withServer(restore, createProductRouteDependencies(), async (baseUrl) => {
      const workspaceResponse = await fetch(`${baseUrl}/api/workspace`, { headers })
      expect(workspaceResponse.status).toBe(200)
      const workspace = (await workspaceResponse.json()) as { repositories: { id: string }[] }
      expect(workspace.repositories.map(({ id }) => id).sort()).toEqual(
        [legacy.id, current.id, other.id].sort(),
      )
      const legacyIndex = await fetch(`${baseUrl}${legacyPath}`, { headers })
      expect(legacyIndex.status).toBe(200)
      expect(await legacyIndex.json()).toMatchObject({
        prototypes: [expect.objectContaining({ id: legacyPrototype.id, name: "Legacy history" })],
      })
      const legacyBuilds = await fetch(`${baseUrl}${legacyPrototypePath}/builds`, { headers })
      expect(legacyBuilds.status).toBe(200)
      expect(await legacyBuilds.json()).toMatchObject({
        builds: [expect.objectContaining({ number: 1, state: "successful" })],
      })
    })
    await expect(
      prisma.repository.findUniqueOrThrow({
        where: { id: legacy.id },
        include: { prototypes: { include: { builds: true } } },
      }),
    ).resolves.toEqual(retainedHistory)
  })

  it.each(["review comments", "learnings"] as const)(
    "does not return %s when legacy visibility is lost after the initial lookup",
    async (resource) => {
      const repository = await prisma.repository.create({
        data: { nameWithOwner: "team/legacy", defaultBranch: "main" },
      })
      const prototype = await prisma.prototype.create({
        data: {
          repositoryId: repository.id,
          branchName: "prototype/legacy",
          name: "Legacy prototype",
          registeredAt: new Date("2026-01-01T00:00:00Z"),
        },
      })
      const build = await prisma.build.create({
        data: { prototypeId: prototype.id, number: 1, state: "successful" },
      })
      const user = await prisma.user.create({
        data: { profile: { create: { provider: "entra", login: "mona", name: "Mona" } } },
      })
      const membership = await prisma.membership.create({ data: { userId: user.id } })
      const secret = "Private legacy content"
      const review = createReviewCommentService(prisma)
      await review.createThread({
        sessionDigest: "a".repeat(64),
        repositoryId: repository.id,
        prototypeId: prototype.id,
        buildNumber: build.number,
        body: secret,
        actor: { userId: user.id, login: "mona", name: "Mona" },
        anchor: {
          schemaVersion: 1,
          kind: "element",
          route: { pathname: "/", search: "", hash: "" },
          selector: "#content",
          accessibleName: "Content",
          tagName: "main",
          selectedText: "",
          rect: { x: 0, y: 0, width: 100, height: 100 },
          viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0 },
          elementOffset: { x: 0.5, y: 0.5 },
        },
      })
      const history = {
        prototypes: { include: { builds: true } },
        reviewThreads: { include: { comments: true } },
      }
      const legacyBefore = await prisma.repository.findUniqueOrThrow({
        where: { id: repository.id },
        include: history,
      })
      const viewer = {
        membershipId: membership.id,
        userId: user.id,
        provider: "entra",
        sessionProvider: "entra",
        login: "mona",
        name: "Mona",
        role: "ADMINISTRATOR" as const,
      }
      const restore = vi.fn().mockResolvedValue(viewer)
      const product = createProductRouteDependencies()
      if (!product.reviewComments) throw new Error("Review comments are unavailable.")
      const listThreads = product.reviewComments.listPrototypeThreads.bind(product.reviewComments)
      let activateDuringRead = false
      async function activate() {
        if (activateDuringRead) await prisma.$transaction(activateGitHubRepositoryScoping)
      }
      const list = vi
        .spyOn(product.reviewComments, "listPrototypeThreads")
        .mockImplementation(async (repositoryId, prototypeId) => {
          const threads = await listThreads(repositoryId, prototypeId)
          await activate()
          return threads
        })
      const learnings = await createLearningsRouteDependencies(
        { HUB_APPLICATION_ORIGIN: "https://hub.example.test", DATABASE_URL: getDatabaseUrl() },
        { restore },
        pino({ level: "silent" }),
      )
      const overview = vi.spyOn(learnings, "getOverview").mockImplementation(async () => {
        await activate()
        return {
          loadError: null,
          identityReviewCount: 0,
          suggestions: [],
          learnings: [],
          recall: { text: secret, count: 1 },
        }
      })
      vi.spyOn(learnings, "getCopilot").mockResolvedValue({ state: "not-connected" })
      vi.spyOn(learnings, "listRuns").mockResolvedValue({
        runs: [],
        usageCredits: "0",
        active: null,
      })

      const path =
        resource === "review comments"
          ? `/api/repositories/${repository.id}/prototypes/${prototype.id}/review-comments`
          : `/api/repositories/${repository.id}/learnings`
      await withServer(
        restore,
        product,
        async (baseUrl) => {
          const headers = { cookie: "hub_session=member-session" }
          const before = await fetch(`${baseUrl}${path}`, { headers })
          expect(before.status).toBe(200)
          const beforeBody = await before.text()
          if (resource === "review comments") {
            expect(beforeBody).toContain(secret)
          } else {
            expect(beforeBody).not.toContain(secret)
          }

          activateDuringRead = true
          if (resource === "learnings") {
            await prisma.$transaction(activateGitHubRepositoryScoping)
          }
          const after = await fetch(`${baseUrl}${path}`, { headers })
          expect(after.status).toBe(404)
          expect(await after.text()).not.toContain(secret)
        },
        learnings,
      )
      expect(resource === "review comments" ? list : overview).toHaveBeenCalledTimes(
        resource === "review comments" ? 2 : 0,
      )
      await expect(
        prisma.repository.findUniqueOrThrow({ where: { id: repository.id }, include: history }),
      ).resolves.toEqual(legacyBefore)
    },
  )

  it("does not disclose a legacy repository to a non-admin when scoping activates after lookup", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/legacy", defaultBranch: "main" },
    })
    const user = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    const restore = vi.fn().mockResolvedValue({
      membershipId: membership.id,
      userId: user.id,
      provider: "entra",
      sessionProvider: "entra",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: "https://hub.example.test", DATABASE_URL: getDatabaseUrl() },
      { restore },
      pino({ level: "silent" }),
    )
    const findRepository = learnings.findRepository.bind(learnings)
    let activateDuringLookup = false
    vi.spyOn(learnings, "findRepository").mockImplementation(async (viewer, repositoryId) => {
      const found = await findRepository(viewer, repositoryId)
      if (activateDuringLookup && found) {
        await prisma.$transaction(activateGitHubRepositoryScoping)
      }
      return found
    })
    await withServer(
      restore,
      createProductRouteDependencies(),
      async (baseUrl) => {
        const path = `/api/repositories/${repository.id}/learnings`
        const headers = { cookie: "hub_session=member-session" }
        const before = await fetch(`${baseUrl}${path}`, { headers })
        expect(before.status).toBe(200)
        expect(await before.text()).toContain("team/legacy")

        activateDuringLookup = true
        const after = await fetch(`${baseUrl}${path}`, { headers })
        const body = await after.text()
        await expect(
          prisma.repository.findUniqueOrThrow({ where: { id: repository.id } }),
        ).resolves.toEqual(repository)
        expect({ status: after.status, disclosedLegacy: body.includes("team/legacy") }).toEqual({
          status: 404,
          disclosedLegacy: false,
        })
      },
      learnings,
    )
  })

  it("preserves every legacy row while keeping its history hidden after a complete installation sync", async () => {
    const legacy = await prisma.repository.create({
      data: { nameWithOwner: "team/reused", defaultBranch: "main" },
    })
    const prototype = await prisma.prototype.create({
      data: {
        repositoryId: legacy.id,
        branchName: "prototype/legacy",
        name: "Retained legacy history",
        registeredAt: new Date("2026-01-01T00:00:00Z"),
      },
    })
    const build = await prisma.build.create({
      data: { prototypeId: prototype.id, number: 1, state: "successful" },
    })
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { currentBuildId: build.id },
    })
    const user = await prisma.user.create({
      data: { profile: { create: { provider: "github", login: "mona", name: "Mona" } } },
    })
    const review = createReviewCommentService(prisma)
    const actor = { userId: user.id, login: "mona", name: "Mona" }
    const reviewInput = {
      sessionDigest: "a".repeat(64),
      repositoryId: legacy.id,
      prototypeId: prototype.id,
      actor,
    }
    const thread = await review.createThread({
      ...reviewInput,
      buildNumber: build.number,
      body: "Retained review",
      anchor: {
        schemaVersion: 1,
        kind: "element",
        route: { pathname: "/", search: "", hash: "" },
        selector: "#content",
        accessibleName: "Content",
        tagName: "main",
        selectedText: "",
        rect: { x: 0, y: 0, width: 100, height: 100 },
        viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0 },
        elementOffset: { x: 0.5, y: 0.5 },
      },
    })
    await review.createReply({ ...reviewInput, threadId: thread.id, body: "Retained reply" })
    await review.setResolution({ ...reviewInput, threadId: thread.id, resolved: true })

    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const github = {
      HUB_APPLICATION_ORIGIN: "https://hub.example.test",
      HUB_AUTHENTICATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
      GITHUB_CLIENT_ID: "github-client",
      GITHUB_CLIENT_SECRET: "github-secret",
      GITHUB_PROVIDER_REVISION: "1",
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(
        privateKey.export({ format: "pem", type: "pkcs1" }),
      ).toString("base64"),
      GITHUB_WEBHOOK_SECRET: "webhook-secret-at-least-twenty-characters",
    }
    const authentication = await createAuthenticationRouteDependencies(github)
    const githubContext = createGitHubAuthenticationContext(github)
    const provider = await prisma.authenticationProvider.findUniqueOrThrow({
      where: { key: "github" },
      include: { selectedRevision: true },
    })
    if (!provider.selectedRevision) throw new Error("GitHub provider has no selected revision.")
    const identity = await prisma.externalIdentity.create({
      data: { userId: user.id, provider: "github", issuer: "https://github.com", subject: "101" },
    })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    await prisma.membershipAssignment.createMany({
      data: [
        {
          externalIdentityId: identity.id,
          membershipId: membership.id,
          providerAssignmentSubject: "github_repository_access",
          providerRevisionId: provider.selectedRevision.id,
          role: "MEMBER",
          source: "AUTHENTICATION_PROVIDER",
        },
        {
          externalIdentityId: identity.id,
          membershipId: membership.id,
          role: "ADMINISTRATOR",
          source: "BOOTSTRAP",
        },
      ],
    })
    const revocation = await prisma.sessionRevocationState.findUniqueOrThrow({
      where: { key: "global" },
    })
    const token = "github-administrator-session"
    await prisma.hubSession.create({
      data: {
        digest: createHash("sha256").update(token).digest("hex"),
        externalIdentityId: identity.id,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        membershipId: membership.id,
        providerRevisionId: provider.selectedRevision.id,
        revocationRevision: revocation.revision,
      },
    })

    const history = {
      prototypes: { include: { builds: true } },
      reviewThreads: {
        include: {
          comments: { orderBy: { publicId: "asc" as const } },
          resolutionEvents: { orderBy: { sequence: "asc" as const } },
        },
      },
    }
    const legacyBefore = await prisma.repository.findUniqueOrThrow({
      where: { id: legacy.id },
      include: history,
    })
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "installation-token" }))
      .mockResolvedValueOnce(
        Response.json({
          total_count: 1,
          repositories: [{ id: 1001, full_name: legacy.nameWithOwner, default_branch: "trunk" }],
        }),
      )
    await syncGitHubInstallationRepositories(
      prisma,
      () =>
        listInstallationRepositories(
          { appId: "123", installationId: "456", privateKey },
          { fetch: request },
        ),
      {
        configurationDigest: githubContext.configurationDigest,
        revision: githubContext.providerRevision,
      },
    )
    expect(request).toHaveBeenCalledTimes(2)
    const current = await prisma.repository.findUniqueOrThrow({
      where: { githubRepositoryId: 1001n },
      include: { prototypes: true, reviewThreads: true },
    })
    expect(current).toMatchObject({
      nameWithOwner: legacy.nameWithOwner,
      defaultBranch: "trunk",
      removedAt: null,
      prototypes: [],
      reviewThreads: [],
    })
    expect(current.id).not.toBe(legacy.id)

    const learnings = await createLearningsRouteDependencies(
      { ...github, DATABASE_URL: getDatabaseUrl() },
      authentication.currentSession,
      pino({ level: "silent" }),
      { scopeGitHubMembers: true },
    )
    const getOverview = vi.spyOn(learnings, "getOverview").mockResolvedValue({
      loadError: null,
      identityReviewCount: 0,
      suggestions: [],
      learnings: [],
      recall: { text: "", count: 0 },
    })
    await withServer(
      authentication.currentSession.restore.bind(authentication.currentSession),
      createProductRouteDependencies({ scopeGitHubMembers: true }),
      async (baseUrl) => {
        const headers = { cookie: `hub_session=${token}` }
        const workspaceResponse = await fetch(`${baseUrl}/api/workspace`, { headers })
        expect(workspaceResponse.status).toBe(200)
        const workspace = (await workspaceResponse.json()) as { repositories: { id: string }[] }
        expect(workspace.repositories.map(({ id }) => id)).toEqual([current.id])
        expect((await fetch(`${baseUrl}/api/repositories/${legacy.id}`, { headers })).status).toBe(
          404,
        )
        expect(
          (await fetch(`${baseUrl}/api/repositories/${legacy.id}/learnings`, { headers })).status,
        ).toBe(404)
        expect(getOverview).not.toHaveBeenCalled()
        const currentIndex = await fetch(`${baseUrl}/api/repositories/${current.id}`, { headers })
        expect(currentIndex.status).toBe(200)
        expect(await currentIndex.json()).toMatchObject({ prototypes: [] })
        const currentLearnings = await fetch(
          `${baseUrl}/api/repositories/${current.id}/learnings`,
          {
            headers,
          },
        )
        expect(currentLearnings.status).toBe(200)
        expect(await currentLearnings.json()).toMatchObject({
          accessDenied: true,
          capabilities: { administerHub: true, administerRepository: false },
        })
        expect(getOverview).not.toHaveBeenCalled()
      },
      learnings,
    )
    await expect(
      prisma.repository.findUniqueOrThrow({ where: { id: legacy.id }, include: history }),
    ).resolves.toEqual(legacyBefore)
  })

  it("keeps unsynced legacy history hidden after restarting without GitHub", async () => {
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
      format: "pem",
      type: "pkcs1",
    })
    const shared = {
      HUB_APPLICATION_ORIGIN: "https://hub.example.test",
      HUB_AUTHENTICATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
    }
    const github = {
      ...shared,
      GITHUB_CLIENT_ID: "github-client",
      GITHUB_CLIENT_SECRET: "github-secret",
      GITHUB_PROVIDER_REVISION: "1",
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(privateKey).toString("base64"),
      GITHUB_WEBHOOK_SECRET: "webhook-secret-at-least-twenty-characters",
    }
    const issuer = "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0"
    const entra = {
      ...shared,
      ENTRA_OIDC_CLIENT_AUTHENTICATION: "client-secret",
      ENTRA_OIDC_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
      ENTRA_OIDC_CLIENT_SECRET: "entra-secret",
      ENTRA_OIDC_ISSUER: issuer,
      ENTRA_OIDC_PROVIDER_REVISION: "1",
    }
    const legacy = await prisma.repository.create({
      data: { nameWithOwner: "team/legacy", defaultBranch: "main" },
    })
    const current = await prisma.repository.create({
      data: { githubRepositoryId: 1001, nameWithOwner: "team/current", defaultBranch: "main" },
    })
    const prototype = await prisma.prototype.create({
      data: {
        repositoryId: legacy.id,
        branchName: "prototype/legacy",
        name: "Retained legacy history",
        registeredAt: new Date("2026-01-01T00:00:00Z"),
      },
    })
    const build = await prisma.build.create({
      data: { prototypeId: prototype.id, number: 1, state: "successful" },
    })
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { currentBuildId: build.id },
    })
    await createAuthenticationRouteDependencies(github)
    const githubContext = createGitHubAuthenticationContext(github)
    const retainedHistory = await prisma.repository.findUniqueOrThrow({
      where: { id: legacy.id },
      include: { prototypes: { include: { builds: true } } },
    })
    const accessState = await prisma.gitHubRepositoryAccessState.findUniqueOrThrow({
      where: { key: "global" },
    })

    await expect(
      syncGitHubInstallationRepositories(
        prisma,
        () => Promise.reject(new Error("Installation listing failed")),
        {
          configurationDigest: githubContext.configurationDigest,
          revision: githubContext.providerRevision,
        },
      ),
    ).rejects.toThrow("Installation listing failed")
    await expect(
      prisma.repository.findUniqueOrThrow({
        where: { id: legacy.id },
        include: { prototypes: { include: { builds: true } } },
      }),
    ).resolves.toEqual(retainedHistory)
    await expect(
      prisma.gitHubRepositoryAccessState.findUniqueOrThrow({ where: { key: "global" } }),
    ).resolves.toEqual(accessState)
    expect(retainedHistory.removedAt).toBeNull()

    for (const key of [
      ...Object.keys(github).filter((name) => name.startsWith("GITHUB_")),
      "ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID",
      "HUB_LOCAL_SIGN_IN",
      "ARTIFACT_STORAGE_PROVIDER",
      "ARTIFACT_STORAGE_DIRECTORY",
      "AZURE_STORAGE_ACCOUNT",
      "AZURE_STORAGE_CONTAINER",
      "CLIENT_DIRECTORY",
      "REPLICA_COPILOT_AUTHENTICATION",
      "REPLICA_COPILOT_TOKEN",
      "REPLICA_COPILOT_GITHUB_INSTALLATION_ID",
      "REPLICA_COPILOT_GITHUB_ORGANIZATION",
      "GITHUB_APP_PRIVATE_KEY",
    ]) {
      vi.stubEnv(key, undefined)
    }
    for (const [key, value] of Object.entries(entra)) vi.stubEnv(key, value)
    vi.stubEnv("RUNTIME_MODE", "api")
    vi.stubEnv("HUB_TRUSTED_PROXY_HOPS", "1")
    vi.stubEnv("OTEL_SDK_DISABLED", "true")
    vi.stubEnv("REPLICA_LEARNING_ROOT", "storage/learning")
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input) => {
        const url = input instanceof Request ? input.url : input.toString()
        if (url !== `${issuer}/.well-known/openid-configuration`) {
          return Promise.reject(new Error(`Unexpected request: ${url}`))
        }
        return Promise.resolve(
          Response.json({
            authorization_endpoint: `${issuer}/oauth2/v2.0/authorize`,
            id_token_signing_alg_values_supported: ["RS256"],
            issuer,
            jwks_uri: `${issuer}/discovery/v2.0/keys`,
            token_endpoint: `${issuer}/oauth2/v2.0/token`,
          }),
        )
      }),
    )
    const startApi = vi.fn<typeof runApi>().mockResolvedValue(undefined)
    vi.doMock("../../../run-api/index.ts", () => ({ runApi: startApi }))
    onTestFinished(() => vi.doUnmock("../../../run-api/index.ts"))
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Unexpected process exit: ${code}`)
    })

    await import("../../../index.ts")
    vi.unstubAllGlobals()
    const startup = startApi.mock.calls[0]?.[0]
    if (!startup?.authentication || !startup.product || !startup.learnings) {
      throw new Error("Restart did not create authenticated product routes.")
    }
    await expect(
      prisma.authenticationProvider.findUniqueOrThrow({ where: { key: "github" } }),
    ).resolves.toMatchObject({ enabled: false })
    const provider = await prisma.authenticationProvider.findUniqueOrThrow({
      where: { key: "entra" },
      include: { selectedRevision: true },
    })
    if (!provider.selectedRevision) throw new Error("Entra provider has no selected revision.")
    const user = await prisma.user.create({
      data: { profile: { create: { provider: "entra", login: "member@example.test" } } },
    })
    const identity = await prisma.externalIdentity.create({
      data: { userId: user.id, provider: "entra", issuer, subject: randomUUID() },
    })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId: identity.id,
        membershipId: membership.id,
        providerAssignmentSubject: randomUUID(),
        providerRevisionId: provider.selectedRevision.id,
        role: "MEMBER",
        source: "AUTHENTICATION_PROVIDER",
      },
    })
    const revocation = await prisma.sessionRevocationState.findUniqueOrThrow({
      where: { key: "global" },
    })
    const token = "entra-session-after-restart"
    await prisma.hubSession.create({
      data: {
        digest: createHash("sha256").update(token).digest("hex"),
        externalIdentityId: identity.id,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        membershipId: membership.id,
        providerRevisionId: provider.selectedRevision.id,
        revocationRevision: revocation.revision,
      },
    })

    const authentication = startup.authentication
    await withServer(
      (digest) => authentication.currentSession.restore(digest),
      startup.product,
      async (url) => {
        const headers = { cookie: `hub_session=${token}` }
        const workspace = await fetch(`${url}/api/workspace`, { headers })
        expect(workspace.status).toBe(200)
        const body = (await workspace.json()) as { repositories: { id: string }[] }
        expect({
          repositoryIds: body.repositories.map(({ id }) => id),
          legacyIndex: (await fetch(`${url}/api/repositories/${legacy.id}`, { headers })).status,
          currentIndex: (await fetch(`${url}/api/repositories/${current.id}`, { headers })).status,
          legacyLearnings: (
            await fetch(`${url}/api/repositories/${legacy.id}/learnings`, { headers })
          ).status,
          currentLearnings: (
            await fetch(`${url}/api/repositories/${current.id}/learnings`, { headers })
          ).status,
        }).toEqual({
          repositoryIds: [current.id],
          legacyIndex: 404,
          currentIndex: 200,
          legacyLearnings: 404,
          currentLearnings: 200,
        })
      },
      startup.learnings,
    )
    await expect(
      prisma.repository.findUniqueOrThrow({
        where: { id: legacy.id },
        include: { prototypes: { include: { builds: true } } },
      }),
    ).resolves.toEqual(retainedHistory)
  }, 15_000)

  it("rescopes workspace repositories when a GitHub administrator becomes a member", async () => {
    const user = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    const readable = await prisma.repository.create({
      data: { githubRepositoryId: 1001, nameWithOwner: "team/readable", defaultBranch: "main" },
    })
    const hidden = await prisma.repository.create({
      data: { githubRepositoryId: 1002, nameWithOwner: "team/hidden", defaultBranch: "main" },
    })
    await prisma.repositoryAccessGrant.create({
      data: { membershipId: membership.id, repositoryId: readable.id, observedAt: new Date() },
    })
    let currentSession = {
      membershipId: membership.id,
      userId: user.id,
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "ADMINISTRATOR" as "MEMBER" | "ADMINISTRATOR",
    }
    const restore = vi.fn(() => Promise.resolve(currentSession))
    const product = createProductRouteDependencies({ scopeGitHubMembers: true })
    const listRepositories = product.listRepositories.bind(product)
    let administratorRepositories: string[] = []
    vi.spyOn(product, "listRepositories").mockImplementation(async (viewer) => {
      const repositories = await listRepositories(viewer)
      if (viewer.role === "ADMINISTRATOR") {
        administratorRepositories = repositories.map(({ id }) => id)
        currentSession = { ...currentSession, role: "MEMBER" }
      }
      return repositories
    })

    await withServer(restore, product, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/workspace`, {
        headers: { cookie: "hub_session=member-session" },
      })

      expect(response.status).toBe(200)
      const workspace = (await response.json()) as {
        repositories: { id: string }[]
        capabilities: { administerHub: boolean }
      }
      expect(administratorRepositories.sort()).toEqual([readable.id, hidden.id].sort())
      expect(workspace.repositories.map(({ id }) => id)).toEqual([readable.id])
      expect(workspace.capabilities.administerHub).toBe(false)
      expect(restore).toHaveBeenCalledTimes(3)
    })
  })

  it("distinguishes malformed, missing, and removed repositories", async () => {
    const removedId = randomUUID()
    await prisma.repository.create({
      data: {
        id: removedId,
        nameWithOwner: "team/removed",
        defaultBranch: "main",
        removedAt: new Date("2026-11-01T00:00:00Z"),
      },
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })
    const headers = { cookie: "hub_session=member-session" }

    await withServer(restore, createProductRouteDependencies(), async (baseUrl) => {
      const malformed = await fetch(`${baseUrl}/api/repositories/not-a-uuid`, { headers })
      const missing = await fetch(`${baseUrl}/api/repositories/${randomUUID()}`, { headers })
      const removed = await fetch(`${baseUrl}/api/repositories/${removedId}`, { headers })

      expect(malformed.status).toBe(400)
      expect(missing.status).toBe(404)
      expect(removed.status).toBe(404)
    })
  })

  it("shows a scoped GitHub member only repositories they can read", async () => {
    const readableId = randomUUID()
    const hiddenId = randomUUID()
    const userId = randomUUID()
    const membershipId = randomUUID()
    await prisma.repository.createMany({
      data: [
        {
          id: readableId,
          githubRepositoryId: 1001,
          nameWithOwner: `team/readable-${readableId}`,
          defaultBranch: "main",
        },
        {
          id: hiddenId,
          githubRepositoryId: 1002,
          nameWithOwner: `team/hidden-${hiddenId}`,
          defaultBranch: "main",
        },
      ],
    })
    await prisma.user.create({ data: { id: userId } })
    await prisma.membership.create({ data: { id: membershipId, userId } })
    await prisma.repositoryAccessGrant.create({
      data: { membershipId, repositoryId: readableId, observedAt: new Date() },
    })
    const hiddenPrototype = await prisma.prototype.create({
      data: {
        repositoryId: hiddenId,
        authorId: userId,
        branchName: "prototype/hidden",
        name: "Hidden",
      },
    })
    const hiddenDetailPath = `/api/repositories/${hiddenId}/prototypes/${hiddenPrototype.id}?view=minimized`
    const viewer = {
      membershipId,
      userId,
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER" as const,
    }
    const headers = { cookie: "hub_session=member-session" }
    const getRepositoryPermission = vi.fn(() => Promise.resolve("write" as const))
    const product = createProductRouteDependencies({
      scopeGitHubMembers: true,
      getRepositoryPermission,
    })

    await withServer(vi.fn().mockResolvedValue(viewer), product, async (baseUrl) => {
      const workspace = await fetch(`${baseUrl}/api/workspace?repositoryId=${hiddenId}`, {
        headers,
      })
      expect(workspace.status).toBe(200)
      expect(await workspace.json()).toMatchObject({
        repositories: [{ id: readableId, capabilities: { managePrototypeListings: true } }],
      })
      expect(getRepositoryPermission).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ userId }),
        readableId,
      )
      const readable = await fetch(`${baseUrl}/api/repositories/${readableId}`, { headers })
      const hidden = await fetch(`${baseUrl}/api/repositories/${hiddenId}`, { headers })
      const hiddenUsers = await fetch(`${baseUrl}/api/repositories/${hiddenId}/authors`, {
        headers,
      })

      expect(readable.status).toBe(200)
      expect(hidden.status).toBe(404)
      const hiddenDetail = await fetch(`${baseUrl}${hiddenDetailPath}`, { headers })

      expect(hiddenUsers.status).toBe(404)
      expect(hiddenDetail.status).toBe(404)
    })
    await withServer(
      vi.fn().mockResolvedValue({ ...viewer, role: "ADMINISTRATOR" }),
      product,
      async (baseUrl) => {
        const hidden = await fetch(`${baseUrl}/api/repositories/${hiddenId}`, { headers })
        const hiddenDetail = await fetch(`${baseUrl}${hiddenDetailPath}`, { headers })

        expect(hidden.status).toBe(200)
        expect(hiddenDetail.status).toBe(200)
      },
    )
  })

  it("returns an error when the repository lookup fails", async () => {
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "entra",
      sessionProvider: "entra",
      login: "member",
      name: "Member",
      role: "MEMBER",
    })
    const product = createProductRouteDependencies()
    vi.spyOn(product, "findRepositoryIndex").mockRejectedValueOnce(
      new Error("Database unavailable"),
    )

    await withServer(restore, product, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/repositories/${randomUUID()}`, {
        headers: { cookie: "hub_session=member-session" },
      })

      expect(response.status).toBe(500)
      expect(await response.json()).not.toHaveProperty("prototypes")
    })
  })

  it("keeps the prototype count consistent when a branch is retired during the read", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    const retiredAt = new Date("2026-11-10T00:00:00Z")
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: {
        id: prototypeId,
        repositoryId,
        branchName: "prototype/welcome",
        name: "Welcome",
        registeredAt: new Date(),
      },
    })
    const writer = new pg.Client({ connectionString: getDatabaseUrl() })
    onTestFinished(() => writer.end())
    await writer.connect()
    let retirement: Promise<void> | undefined
    async function readWhileRetiring<Result>(read: () => Promise<Result>) {
      if (!retirement) {
        const firstRead = read()
        retirement = firstRead.then(async () => {
          await writer.query("UPDATE prototypes SET branch_deleted_at = $1 WHERE id = $2", [
            retiredAt,
            prototypeId,
          ])
        })
        await retirement
        return firstRead
      }
      await retirement
      return read()
    }
    const reader = prisma.$extends({
      query: {
        prototype: {
          findMany({ args, query }) {
            return readWhileRetiring(() => query(args))
          },
          count({ args, query }) {
            return readWhileRetiring(() => query(args))
          },
        },
      },
    })
    // Prisma does not type an extended client as the base client.
    const database = reader as unknown as Parameters<typeof findRepositoryIndex>[0]
    const index = await findRepositoryIndex(database, repositoryId)

    expect(index).toMatchObject({
      prototypes: [{ id: prototypeId }],
      pagination: { totalCount: 1 },
    })
    expect(
      await prisma.prototype.findUnique({
        where: { id: prototypeId },
        select: { branchDeletedAt: true },
      }),
    ).toEqual({ branchDeletedAt: retiredAt })
  })

  it("does not return an index when a repository changes during the read", async () => {
    const removedId = randomUUID()
    const changedId = randomUUID()
    const removedPrototypeId = randomUUID()
    const changedPrototypeId = randomUUID()
    const removedAt = new Date("2026-11-10T00:00:00Z")
    await prisma.repository.createMany({
      data: [
        { id: removedId, nameWithOwner: "team/removed-after-read", defaultBranch: "main" },
        { id: changedId, nameWithOwner: "team/changed-after-read", defaultBranch: "main" },
      ],
    })
    await prisma.prototype.createMany({
      data: [
        {
          id: removedPrototypeId,
          repositoryId: removedId,
          branchName: "prototype/removed",
          name: "Removed repository prototype",
          registeredAt: new Date(),
        },
        {
          id: changedPrototypeId,
          repositoryId: changedId,
          branchName: "prototype/default",
          name: "New default branch",
          registeredAt: new Date(),
        },
      ],
    })
    const writer = new pg.Client({ connectionString: getDatabaseUrl() })
    onTestFinished(() => writer.end())
    await writer.connect()
    async function removeRepository() {
      await writer.query("UPDATE repositories SET removed_at = $1 WHERE id = $2", [
        removedAt,
        removedId,
      ])
    }
    async function changeDefaultBranch() {
      await writer.query("UPDATE repositories SET default_branch = $1 WHERE id = $2", [
        "prototype/default",
        changedId,
      ])
    }
    let changeRepository = removeRepository
    const prototypeIds: (string | undefined)[] = []
    const reader = prisma.$extends({
      query: {
        prototype: {
          async findMany({ args, query }) {
            const prototypes = await query(args)
            prototypeIds.push(...prototypes.map(({ id }) => id))
            await changeRepository()
            return prototypes
          },
        },
      },
    })
    const database = reader as unknown as Parameters<typeof findRepositoryIndex>[0]
    const removedIndex = await findRepositoryIndex(database, removedId)
    changeRepository = changeDefaultBranch
    const changedIndex = await findRepositoryIndex(database, changedId)

    expect(prototypeIds).toEqual([removedPrototypeId, changedPrototypeId])
    expect(
      await prisma.repository.findUnique({ where: { id: removedId }, select: { removedAt: true } }),
    ).toEqual({ removedAt })
    expect(
      await prisma.repository.findUnique({
        where: { id: changedId },
        select: { defaultBranch: true },
      }),
    ).toEqual({ defaultBranch: "prototype/default" })
    expect([removedIndex, changedIndex]).toEqual([null, null])
  })

  it("protects active branch and registration invariants while retaining deleted history", async () => {
    const first = new pg.Client({ connectionString: getDatabaseUrl() })
    const second = new pg.Client({ connectionString: getDatabaseUrl() })
    onTestFinished(async () => {
      await Promise.all([first.end(), second.end()])
    })
    await Promise.all([first.connect(), second.connect()])
    const repositoryId = randomUUID()
    await first.query(
      `INSERT INTO repositories (id, name_with_owner, default_branch)
       VALUES ($1, 'team/design', 'main')`,
      [repositoryId],
    )
    await first.query(
      `INSERT INTO prototypes (id, repository_id, branch_name, name, branch_deleted_at)
       VALUES ($1, $2, 'prototype/shared', 'Retired', clock_timestamp())`,
      [randomUUID(), repositoryId],
    )
    function insertActive(database: pg.Client) {
      return database.query(
        `INSERT INTO prototypes (id, repository_id, branch_name, name, registered_at)
         VALUES ($1, $2, 'prototype/shared', 'Active', clock_timestamp())`,
        [randomUUID(), repositoryId],
      )
    }
    const attempts = await Promise.allSettled([insertActive(first), insertActive(second)])
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    const rejected = attempts.find((attempt) => attempt.status === "rejected")
    expect(rejected).toMatchObject({ reason: { code: "23505" } })
    const versions = await first.query<{ active: boolean }>(
      `SELECT branch_deleted_at IS NULL AS active
       FROM prototypes WHERE repository_id = $1 AND branch_name = 'prototype/shared'
       ORDER BY active`,
      [repositoryId],
    )
    expect(versions.rows).toEqual([{ active: false }, { active: true }])

    for (const [branchName, name, replica] of [
      ["prototype/null-name", null, false],
      ["prototype/blank-name", "   ", false],
      ["prototype/whitespace-name", " \t\n ", false],
      ["prototype/next-line", "\u0085", false],
      ["prototype/no-break-space", "\u00a0", false],
      ["prototype/em-space", "\u2003", false],
      ["prototype/narrow-no-break-space", "\u202f", false],
      ["prototype/byte-order-mark", "\ufeff", false],
      ["replica/registered", "Replica", true],
    ] as const) {
      await expect(
        first.query(
          `INSERT INTO prototypes (id, repository_id, branch_name, name, registered_at, replica)
           VALUES ($1, $2, $3, $4, clock_timestamp(), $5)`,
          [randomUUID(), repositoryId, branchName, name, replica],
        ),
      ).rejects.toMatchObject({ code: "23514" })
    }
    await expect(
      first.query(
        `INSERT INTO prototypes (id, repository_id, branch_name, replica)
         VALUES ($1, $2, 'replica/unregistered', true)`,
        [randomUUID(), repositoryId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 })
  })
})
