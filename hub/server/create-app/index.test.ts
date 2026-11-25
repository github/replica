import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { Prisma } from "../generated/prisma/client"
import { createLogger } from "../integrations/pino/create-logger"
import type { AuthenticationRouteDependencies } from "../routes/api/auth/types"
import type { ProductRouteDependencies } from "../routes/api/product/types"
import type { PublicSharingRouteDependencies } from "../routes/api/public-sharing/types"
import type { BuildPreviewRouteDependencies } from "../routes/build-preview/types"

import { createApp } from "."

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseRecord(line: string) {
  const value: unknown = JSON.parse(line)
  if (!isRecord(value)) throw new Error("Expected a JSON log object")
  return value
}

describe("createApp()", () => {
  it("omits public and preview bearer values from request logs", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })
    const server = createServer(createApp({ logger }))

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo
      const base = `http://127.0.0.1:${port}`

      await fetch(`${base}/api/shared/secret-share-id?grant=secret-public-grant`)
      await fetch(`${base}/__replica/authorize?grant=secret-preview-grant`)

      expect(records).toHaveLength(2)
      for (const record of records) {
        expect(record).not.toHaveProperty("params")
        expect(record).not.toHaveProperty("query")
        expect(JSON.stringify(record)).not.toContain("secret")
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("serves built assets and HTML navigation without masking missing API routes or assets", async () => {
    const clientDirectory = join(process.cwd(), `runtime-client-test-${randomUUID()}`)
    await mkdir(join(clientDirectory, "assets"), { recursive: true })
    onTestFinished(() => rm(clientDirectory, { recursive: true, force: true }))
    const html = "<!doctype html><title>Built Hub</title>"
    await writeFile(join(clientDirectory, "index.html"), html)
    await writeFile(join(clientDirectory, "assets", "app.js"), "export const built = true")
    const server = createServer(
      createApp({ clientDirectory, logger: createLogger({ level: "silent" }) }),
    )

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo
      const base = `http://127.0.0.1:${port}`
      const navigation = await fetch(`${base}/projects/example`, {
        headers: { accept: "text/html" },
      })
      expect(navigation.status).toBe(200)
      expect(navigation.headers.get("content-type")).toMatch(/^text\/html\b/)
      expect(await navigation.text()).toBe(html)
      const head = await fetch(`${base}/projects/example`, {
        method: "HEAD",
        headers: { accept: "text/html" },
      })
      expect(head.status).toBe(200)
      expect(head.headers.get("content-type")).toMatch(/^text\/html\b/)
      expect(await head.text()).toBe("")
      const asset = await fetch(`${base}/assets/app.js`)
      expect(asset.status).toBe(200)
      expect(await asset.text()).toBe("export const built = true")

      for (const { path, method, accept } of [
        { path: "/api/missing", method: "GET", accept: "text/html" },
        { path: "/assets/missing.js", method: "GET", accept: "text/html" },
        { path: "/projects/example", method: "POST", accept: "text/html" },
        { path: "/projects/example", method: "GET", accept: "application/json" },
        { path: "/projects/example", method: "GET", accept: "*/*" },
      ]) {
        const missing = await fetch(`${base}${path}`, { method, headers: { accept } })
        expect.soft(missing.status, `${method} ${path} accepting ${accept}`).toBe(404)
        expect.soft(missing.headers.get("content-type")).toMatch(/^application\/json\b/)
        if (missing.status === 404) {
          expect(await missing.json()).toEqual({ error: "Not found" })
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("reports unavailable dependencies safely without making process health fail", async () => {
    const isReady = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
    const server = createServer(createApp({ isReady, logger: createLogger({ level: "silent" }) }))

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo
      const base = `http://127.0.0.1:${port}`
      const unavailable = await fetch(`${base}/api/ready`)
      expect(unavailable.status).toBe(503)
      const health = await fetch(`${base}/api/health`)
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ status: "ok" })

      isReady.mockResolvedValue(true)
      expect((await fetch(`${base}/api/ready`)).status).toBe(200)
      isReady.mockRejectedValue(new Error("postgresql://test:private-readiness-marker@localhost"))
      const failed = await fetch(`${base}/api/ready`)
      expect(failed.status).toBe(503)
      expect(await failed.text()).not.toContain("private-readiness-marker")
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("accepts a broadcast dependency without changing HTTP routes", async () => {
    const broadcast = vi.fn()
    const server = createServer(createApp({ broadcast }))

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo
      const health = await fetch(`http://127.0.0.1:${port}/api/health`)
      const missing = await fetch(`http://127.0.0.1:${port}/api/realtime`)

      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ status: "ok" })
      expect(missing.status).toBe(404)
      expect(broadcast).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it.each([
    {
      outcome: "hits a statement timeout",
      lookup: () =>
        Promise.reject(
          new Prisma.PrismaClientKnownRequestError("Unread query timed out", {
            code: "P2010",
            clientVersion: "test",
            meta: { code: "57014" },
          }),
        ),
    },
    {
      outcome: "loses the PostgreSQL connection",
      lookup: () => Promise.reject(new Error("Connection terminated unexpectedly")),
    },
    {
      outcome: "never settles",
      lookup: () => new Promise<boolean>(() => {}),
    },
  ])("keeps navigation available when the unread lookup $outcome", async ({ lookup }) => {
    const viewer = {
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      sessionProvider: "github",
      login: "octocat",
      name: "The Octocat",
      role: "MEMBER" as const,
    }
    const repository = {
      id: randomUUID(),
      nameWithOwner: "team/alpha",
      defaultBranch: "main",
      localPath: null,
    }
    const restore = vi.fn().mockResolvedValue(viewer)
    const authentication: AuthenticationRouteDependencies = {
      currentSession: { restore },
      signOut: { applicationOrigin: "https://hub.example.com", secureCookie: false, end: vi.fn() },
    }
    const getRepositoryPermission = vi.fn().mockResolvedValue("admin")
    const hasUnread = vi.fn(lookup)
    const product: ProductRouteDependencies = {
      getRepositoryPermission,
      reviewInbox: { hasUnread, list: vi.fn(), find: vi.fn(), setRead: vi.fn() },
      isRepositoryVisible: vi.fn().mockResolvedValue(true),
      listRepositories: vi.fn().mockResolvedValue([repository]),
      findRepositoryIndex: vi.fn(),
      findPrototypeDetail: vi.fn(),
      findPrototypeManagement: vi.fn(),
      readPrototypeWithIntroduction: vi.fn(),
      findRepositoryAuthors: vi.fn(),
      editPrototypeMetadata: vi.fn(),
      findBuildPreviewTarget: vi.fn(),
    }
    const server = createServer(
      createApp({ authentication, product, logger: createLogger({ level: "silent" }) }),
    )

    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    onTestFinished(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
          server.closeAllConnections()
        }),
    )
    const { port } = server.address() as AddressInfo
    const base = `http://127.0.0.1:${port}/api/workspace`
    const headers = { cookie: "hub_session=github-session" }

    expect((await fetch(`${base}?view=navigation`)).status).toBe(401)
    const navigation = await fetch(`${base}?view=navigation`, { headers })
    expect(navigation.status).toBe(200)
    expect(restore).toHaveBeenCalled()
    expect(getRepositoryPermission).not.toHaveBeenCalled()
    const workspace: unknown = await navigation.json()
    expect(workspace).toMatchObject({
      viewer: { id: viewer.userId },
      repositoryPermissionsAvailable: true,
      reviewInboxAvailable: true,
      repositories: [
        {
          id: repository.id,
          nameWithOwner: repository.nameWithOwner,
          capabilities: { reviewPrototypes: true },
        },
      ],
    })
    expect(workspace).not.toHaveProperty("inboxHasUnread")
    expect(workspace).not.toHaveProperty("repositories.0.capabilities.administerRepository")
    expect(workspace).not.toHaveProperty("repositories.0.capabilities.managePrototypeListings")

    const verified = await fetch(`${base}?repositoryId=${repository.id}`, { headers })
    expect(verified.status).toBe(200)
    expect(hasUnread).toHaveBeenCalledTimes(1)
    expect(getRepositoryPermission).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ membershipId: viewer.membershipId, sessionProvider: "github" }),
      repository.id,
    )
    expect(await verified.json()).toMatchObject({
      repositories: [
        {
          id: repository.id,
          capabilities: { administerRepository: true, managePrototypeListings: true },
        },
      ],
    })
  })

  it("composes review and public sharing routes without crossing their authorities", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    const shareId = randomUUID()
    const buildId = randomUUID()
    const remoteRepositoryId = randomUUID()
    const userId = randomUUID()
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId,
      provider: "local",
      login: "local-developer",
      name: "Local developer",
      role: "MEMBER",
    })
    const listPrototypeThreads = vi.fn().mockResolvedValue([])
    const authorizeReviewAccess = vi.fn().mockResolvedValue({ canView: true, canChange: true })
    const readPublicLink = vi.fn().mockResolvedValue({
      state: "active" as const,
      id: randomUUID(),
      buildId,
      buildNumber: 4,
      expiresAt: new Date("2026-11-20T12:00:00Z"),
      label: "Partner review",
      prototypeName: "Checkout",
      startPage: "/",
    })
    const readAvailableLink = vi.fn()
    const authentication: AuthenticationRouteDependencies = {
      currentSession: { restore },
      signOut: { applicationOrigin: "https://hub.example.com", secureCookie: false, end: vi.fn() },
    }
    const product: ProductRouteDependencies = {
      reviewComments: {
        listPrototypeThreads,
        createThread: vi.fn(),
        createReply: vi.fn(),
        editComment: vi.fn(),
        deleteComment: vi.fn(),
        setResolution: vi.fn(),
        setReaction: vi.fn(),
        markThreadRead: vi.fn(),
      },
      authorizeReviewAccess,
      isRepositoryVisible: vi.fn().mockResolvedValue(true),
      listRepositories: vi.fn().mockResolvedValue([
        {
          id: repositoryId,
          nameWithOwner: "local/minimal",
          defaultBranch: "main",
          localPath: "/workspace/minimal",
        },
        {
          id: remoteRepositoryId,
          nameWithOwner: "github/remote",
          defaultBranch: "main",
          localPath: null,
        },
      ]),
      findRepositoryIndex: vi.fn(),
      findPrototypeDetail: vi.fn(),
      readPrototypeWithIntroduction: vi.fn(),
      findRepositoryAuthors: vi.fn(),
      editPrototypeMetadata: vi.fn(),
      findBuildPreviewTarget: vi.fn(),
    }
    const publicSharing: PublicSharingRouteDependencies = {
      applicationOrigin: "https://hub.example.com",
      previewBaseOrigin: "https://preview.example.com",
      maximumDays: 7,
      getSettings: vi.fn(),
      changeSettings: vi.fn(),
      listLinks: vi.fn(),
      createLink: vi.fn(),
      revokeLink: vi.fn(),
      readPublicLink,
      readAvailableLink,
    }
    const preview: BuildPreviewRouteDependencies = {
      applicationOrigin: "https://hub.example.com",
      previewBaseOrigin: "https://preview.example.com",
      encryptionKey: randomBytes(32),
      storage: {
        isReady: vi.fn(),
        read: vi.fn(),
        write: vi.fn(),
        delete: vi.fn(),
      },
      bridgeSource: "",
      findTargetById: vi.fn(),
      findArtifact: vi.fn(),
      readAvailableShareLink: readAvailableLink,
    }
    const server = createServer(
      createApp({
        authentication,
        product,
        publicSharing,
        preview,
        logger: createLogger({ level: "silent" }),
      }),
    )

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo
      const base = `http://127.0.0.1:${port}`

      const shared = await fetch(`${base}/api/shared/${shareId}`)
      expect(shared.status).toBe(200)
      expect(restore).not.toHaveBeenCalled()
      expect(listPrototypeThreads).not.toHaveBeenCalled()

      const review = await fetch(
        `${base}/api/repositories/${repositoryId}/prototypes/${prototypeId}/review-comments`,
        { headers: { cookie: "hub_session=local-session" } },
      )
      expect(review.status).toBe(200)
      expect(await review.json()).toEqual({ comments: [], nextCursor: null, hasMore: false })
      expect(listPrototypeThreads).toHaveBeenCalledWith(repositoryId, prototypeId, userId)
      expect(readPublicLink).toHaveBeenCalledOnce()

      const workspace = await fetch(`${base}/api/workspace`, {
        headers: { cookie: "hub_session=local-session" },
      })
      expect(workspace.status).toBe(200)
      expect(await workspace.json()).toMatchObject({
        capabilities: { manageSharing: false, reviewPrototypes: false },
        repositories: [
          {
            id: repositoryId,
            capabilities: { manageSharing: true, reviewPrototypes: true },
          },
          {
            capabilities: { manageSharing: false, reviewPrototypes: false },
          },
        ],
      })

      restore.mockResolvedValue({
        membershipId: randomUUID(),
        userId: randomUUID(),
        provider: "github",
        sessionProvider: "github",
        login: "octocat",
        name: "The Octocat",
        role: "MEMBER",
      })
      const hostedWorkspace = await fetch(`${base}/api/workspace`, {
        headers: { cookie: "hub_session=github-session" },
      })
      expect(await hostedWorkspace.json()).toMatchObject({
        repositories: [
          {
            id: repositoryId,
            capabilities: { manageSharing: false, reviewPrototypes: false },
          },
          {
            id: remoteRepositoryId,
            capabilities: { manageSharing: false, reviewPrototypes: true },
          },
        ],
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("automatically logs health and not-found responses with the injected logger", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })
    const server = createServer(createApp({ logger }))

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo

      const headers = { "x-request-id": "untrusted-request-id" }
      const health = await fetch(`http://127.0.0.1:${port}/api/health`, { headers })
      expect(health.status).toBe(200)
      expect(health.headers.get("content-type")).toMatch(/^application\/json\b/)
      expect(await health.json()).toEqual({ status: "ok" })
      const missing = await fetch(
        `http://127.0.0.1:${port}/api/missing-private-path?token=query-secret`,
        { headers },
      )
      expect(missing.status).toBe(404)
      expect(missing.headers.get("content-type")).toMatch(/^application\/json\b/)
      expect(await missing.json()).toEqual({ error: "Not found" })
      expect(health.headers.get("x-request-id")).not.toBe(missing.headers.get("x-request-id"))

      await vi.waitFor(() => expect(records).toHaveLength(2))
      expect(records[0]).toMatchObject({
        reqId: health.headers.get("x-request-id"),
        method: "GET",
        route: "/api/health",
        statusCode: 200,
        level: 30,
        outcome: "completed",
      })
      expect(records[1]).toMatchObject({
        reqId: missing.headers.get("x-request-id"),
        route: null,
        statusCode: 404,
        level: 40,
        outcome: "completed",
      })
      expect(JSON.stringify(records)).not.toMatch(
        /missing-private-path|query-secret|untrusted-request-id/,
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it.each([
    { name: "malformed", body: '{"password":"malformed-body-secret"', statusCode: 400 },
    { name: "oversized", body: JSON.stringify({ text: "x".repeat(1024 * 1024) }), statusCode: 413 },
  ])("logs $name JSON safely before routing", async ({ body, statusCode }) => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(parseRecord(line)) },
    })

    const server = createServer(createApp({ logger }))
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo

      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })

      expect(response.status).toBe(statusCode)
      expect(response.headers.get("content-type")).toMatch(/^application\/json\b/)
      expect(await response.json()).toEqual({ error: "Invalid request" })
      await vi.waitFor(() => expect(records).toHaveLength(1))
      expect(records[0]).toMatchObject({
        reqId: response.headers.get("x-request-id"),
        statusCode,
        level: 40,
        outcome: "completed",
      })
      expect(records[0]).not.toHaveProperty("body")
      expect(records[0]).not.toHaveProperty("err")
      expect(records[0]).not.toHaveProperty("req")
      expect(records[0]).not.toHaveProperty("res")
      expect(JSON.stringify(records)).not.toContain("malformed-body-secret")
      expect(stderr).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it.each([
    { method: "GET", path: "/repositories" },
    { method: "POST", path: "/auth/github" },
  ])("does not port the former $method $path endpoint", async ({ method, path }) => {
    const server = createServer(createApp())

    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo

      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        redirect: "manual",
      })

      expect(response.status).toBe(404)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("does not accept authentication proof from a public callback route", async () => {
    const server = createServer(createApp())
    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/github/callback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          externalIdentityId: randomUUID(),
          providerKey: "github",
          subject: "123",
        }),
      })

      expect(response.status).toBe(404)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
