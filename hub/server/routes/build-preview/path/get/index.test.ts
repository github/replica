import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { join, resolve } from "node:path"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../../create-app"
import type { ArtifactStorage } from "../../../../domains/artifacts/create-artifact-storage/types"
import { createSharePreviewSession } from "../../../../domains/public-sharing/create-share-preview-session"
import { createLogger } from "../../../../integrations/pino/create-logger"
import type { AuthenticationRouteDependencies } from "../../../api/auth/types"
import type { ProductRouteDependencies } from "../../../api/product/types"
import type { BuildPreviewRouteDependencies } from "../../types"

interface RouteResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

async function request(
  origin: string,
  path: string,
  headers: Record<string, string> = { cookie: "hub_session=member-session" },
): Promise<RouteResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(origin)
    const outgoing = httpRequest(
      { hostname: url.hostname, port: url.port, path, headers },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        )
      },
    )
    outgoing.on("error", reject)
    outgoing.end()
  })
}

async function createFixture() {
  const directory = resolve(`server/routes/build-preview/path/get/.preview-test-${randomUUID()}`)
  const clientDirectory = join(directory, "client")
  await mkdir(clientDirectory, { recursive: true })
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(clientDirectory, "index.html"), "<title>Hub shell marker</title>")
  const artifacts = new Map<string, { storageKey: string; byteLength: number }>()
  const savedBytes = new Map<string, Uint8Array>()
  const storage: ArtifactStorage = {
    isReady: vi.fn(),
    read(key) {
      const bytes = savedBytes.get(key)
      return Promise.resolve(bytes ? { status: "ok", bytes } : { status: "not-found" })
    },
    write: vi.fn(),
    delete: vi.fn(),
  }
  function save(path: string, content: string | Uint8Array) {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content
    const storageKey = randomUUID()
    savedBytes.set(storageKey, bytes)
    artifacts.set(path, { storageKey, byteLength: bytes.byteLength })
  }
  const buildId = randomUUID()
  const repositoryId = randomUUID()
  const mountPath = "/previews/github/2001/3002"
  const viewer = {
    membershipId: randomUUID(),
    userId: randomUUID(),
    provider: "github",
    sessionProvider: "github",
    login: "mona",
    name: "Mona",
    role: "MEMBER" as const,
  }
  const restore = vi
    .fn<AuthenticationRouteDependencies["currentSession"]["restore"]>()
    .mockResolvedValue(viewer)
  const isRepositoryVisible = vi
    .fn<ProductRouteDependencies["isRepositoryVisible"]>()
    .mockResolvedValue(true)
  const product: ProductRouteDependencies = {
    isRepositoryVisible,
    listRepositories: vi.fn(),
    findRepositoryIndex: vi.fn(),
    findRepositoryAuthors: vi.fn(),
    findPrototypeDetail: vi.fn(),
    readPrototypeWithIntroduction: vi.fn(),
    editPrototypeMetadata: vi.fn(),
    findBuildPreviewTarget: vi.fn(),
  }
  const target = { buildId, repository: { id: repositoryId, local: false }, template: false }
  const findPathTargets = vi
    .fn<NonNullable<BuildPreviewRouteDependencies["findPathTargets"]>>()
    .mockResolvedValue([target])
  const findArtifact = vi
    .fn<BuildPreviewRouteDependencies["findArtifact"]>()
    .mockImplementation((id, path) =>
      Promise.resolve(id === buildId ? (artifacts.get(path) ?? null) : null),
    )
  const readAvailableShareLink = vi.fn().mockResolvedValue({
    expiresAt: new Date(Date.now() + 60_000),
    startPage: "/",
  })
  const preview: BuildPreviewRouteDependencies = {
    applicationOrigin: "https://hub.example.com",
    encryptionKey: randomBytes(32),
    storage,
    bridgeSource: "globalThis.ReplicaHostedPreviewBridge={installHostedBridge(){}}",
    findPathTargets,
    findArtifact,
    readAvailableShareLink,
  }
  const server = createServer()
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`
  preview.applicationOrigin = origin
  server.on(
    "request",
    createApp({
      clientDirectory,
      logger: createLogger({ level: "silent" }),
      authentication: {
        currentSession: { restore },
        signOut: { applicationOrigin: preview.applicationOrigin, secureCookie: true, end: vi.fn() },
      },
      preview,
      product,
    }),
  )
  return {
    origin,
    mountPath,
    preview,
    viewer,
    target,
    restore,
    isRepositoryVisible,
    findPathTargets,
    findArtifact,
    readAvailableShareLink,
    storage,
    save,
  }
}

describe("get()", () => {
  it("serves mounted files, nested indexes and HTML routes without falling back for missing assets", async () => {
    const fixture = await createFixture()
    const { origin, mountPath, save, findPathTargets, isRepositoryVisible, viewer, target } =
      fixture
    save("dist/index.html", "<html><head></head><body>Private prototype</body></html>")
    save("dist/docs/index.html", "<html><head></head><body>Nested page</body></html>")
    save("dist/assets/app.css", "body { display: block }")

    for (const [path, contentType, content] of [
      ["/", "text/html", "Private prototype"],
      ["/docs/", "text/html", "Nested page"],
      ["/checkout/cart?step=shipping", "text/html", "Private prototype"],
      ["/assets/app.css", "text/css", "body { display: block }"],
    ] as const) {
      const response = await request(origin, `${mountPath}${path}`, {
        cookie: "hub_session=member-session",
        accept: "text/html",
      })

      expect(response.status, path).toBe(200)
      expect(response.headers["content-type"]).toContain(contentType)
      expect(response.body.toString()).toContain(content)
      expect(response.headers["cache-control"]).toMatch(/\b(?:no-cache|no-store)\b/)
      expect(response.headers["cache-control"]).not.toContain("immutable")
      expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'self'")
      if (contentType === "text/html") {
        expect(response.body.toString()).toContain(
          `<script src="${mountPath}/__replica/bridge/v1.js"></script>`,
        )
      }
    }
    expect(findPathTargets).toHaveBeenCalledWith("2001", "3002")
    expect(isRepositoryVisible).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: viewer.membershipId }),
      target.repository.id,
    )

    for (const [path, accept] of [
      ["/assets/missing.js", "text/html"],
      ["/missing-route", "application/json"],
    ] as const) {
      const missing = await request(origin, `${mountPath}${path}`, {
        cookie: "hub_session=member-session",
        accept,
      })
      expect(missing.status, path).toBe(404)
      expect(missing.body.toString()).not.toContain("Hub shell marker")
      expect(missing.body.toString()).not.toContain("Private prototype")
    }
  })

  it("adds the canonical trailing slash without losing the query", async () => {
    const { origin, mountPath } = await createFixture()

    const response = await request(origin, `${mountPath}?step=shipping&return=%2Fcart`)

    expect(response.status).toBe(308)
    expect(response.headers.location).toBe(`${mountPath}/?step=shipping&return=%2Fcart`)
  })

  it("rejects malformed identifiers and unsafe raw paths before reading storage or the Hub shell", async () => {
    const { origin, mountPath, storage, findArtifact } = await createFixture()
    const read = vi.spyOn(storage, "read")

    for (const path of [
      "/previews/github/0/3002/",
      "/previews/github/02001/3002/",
      "/previews/github/%32%30%30%31/3002/",
      "/previews/github/2001/0/",
      "/previews/github/2001/03002/",
      "/previews/github/2001/3e3/",
      "/previews/github/2001/%33%30%30%32/",
      `${mountPath}/../private`,
      `${mountPath}/%2e%2e/private`,
      `${mountPath}/%252e%252e/private`,
      `${mountPath}/assets%2fprivate`,
      `${mountPath}/assets%5cprivate`,
      `${mountPath}/assets\\private`,
      `${mountPath}/bad%00path`,
      `${mountPath}/bad%1fpath`,
      `${mountPath}/bad%`,
    ]) {
      const response = await request(origin, path, {
        cookie: "hub_session=member-session",
        accept: "text/html",
      })

      expect(response.status, path).toBe(404)
      expect(response.body.toString(), path).not.toContain("Hub shell marker")
    }
    expect(findArtifact).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it("does not accept public-share or wildcard-preview cookies as a Hub session", async () => {
    const { origin, mountPath, preview, target, save, storage, readAvailableShareLink } =
      await createFixture()
    save("dist/index.html", "<html><head></head><body>Private prototype</body></html>")
    const read = vi.spyOn(storage, "read")
    const share = createSharePreviewSession(
      {
        buildId: target.buildId,
        shareLinkId: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      preview.encryptionKey,
    )
    for (const cookie of [
      "",
      `replica_share_preview=${encodeURIComponent(share)}`,
      "replica_preview=obsolete-private-cookie",
    ]) {
      const response = await request(origin, `${mountPath}/`, { cookie, accept: "text/html" })

      expect(response.status).toBe(401)
      expect(response.body.toString()).not.toContain("Hub shell marker")
      expect(response.body.toString()).not.toContain("Private prototype")
    }
    expect(read).not.toHaveBeenCalled()
    expect(readAvailableShareLink).not.toHaveBeenCalled()
  })

  it.each(["session expiry", "repository revocation"])(
    "rechecks %s on a subsequent asset request",
    async (change) => {
      const { origin, mountPath, save, restore, isRepositoryVisible } = await createFixture()
      save("dist/assets/app.css", "private-asset")
      const first = await request(origin, `${mountPath}/assets/app.css`)
      expect(first.status).toBe(200)
      expect(first.body.toString()).toBe("private-asset")
      expect(first.headers["cache-control"]).toMatch(/\b(?:no-cache|no-store)\b/)

      if (change === "session expiry") restore.mockResolvedValue(null)
      else isRepositoryVisible.mockResolvedValue(false)
      const denied = await request(origin, `${mountPath}/assets/app.css`)

      expect(denied.status).toBe(change === "session expiry" ? 401 : 404)
      expect(denied.body.toString()).not.toContain("private-asset")
    },
  )

  it.each(["session expiry", "repository revocation"])(
    "discards artifact bytes when %s occurs during storage read",
    async (change) => {
      const { origin, mountPath, save, storage, restore, isRepositoryVisible } =
        await createFixture()
      save("dist/assets/app.css", "private-artifact-bytes")
      const read = storage.read.bind(storage)
      const reading = vi.spyOn(storage, "read").mockImplementation(async (key) => {
        const result = await read(key)
        if (change === "session expiry") restore.mockResolvedValue(null)
        else isRepositoryVisible.mockResolvedValue(false)
        return result
      })

      const response = await request(origin, `${mountPath}/assets/app.css`)

      expect(reading).toHaveBeenCalledOnce()
      expect(response.status).toBe(404)
      expect(response.body.toString()).not.toContain("private-artifact-bytes")
    },
  )

  it("fails closed for missing or ambiguous owning-run targets instead of serving Hub navigation", async () => {
    const { origin, mountPath, findPathTargets, target, storage } = await createFixture()
    const read = vi.spyOn(storage, "read")

    for (const targets of [[], [target, { ...target, buildId: randomUUID() }]]) {
      findPathTargets.mockResolvedValue(targets)

      const response = await request(origin, `${mountPath}/checkout`, {
        cookie: "hub_session=member-session",
        accept: "text/html",
      })

      expect(response.status).toBe(404)
      expect(response.body.toString()).not.toContain("Hub shell marker")
    }
    expect(read).not.toHaveBeenCalled()
  })

  it("refuses Service Worker script requests even when their artifact exists", async () => {
    const { origin, mountPath, save, storage } = await createFixture()
    save("dist/service-worker.js", "self.addEventListener('fetch', () => {})")
    const read = vi.spyOn(storage, "read")

    const response = await request(origin, `${mountPath}/service-worker.js`, {
      cookie: "hub_session=member-session",
      "service-worker": "script",
    })

    expect(response.status).toBe(404)
    expect(read).not.toHaveBeenCalled()
  })
})
