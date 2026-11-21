import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { mkdir, rm, writeFile } from "node:fs/promises"
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import { join, resolve } from "node:path"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../../create-app"
import type { ArtifactStorage } from "../../../../domains/artifacts/create-artifact-storage/types"
import { reserveBuildPreviewBytes } from "../../../../domains/build-preview/reserve-build-preview-bytes"
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function request(
  origin: string,
  path: string,
  headers: Record<string, string> = { cookie: "hub_session=member-session" },
  method = "GET",
  signal?: AbortSignal,
): Promise<RouteResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(origin)
    const outgoing = httpRequest(
      { hostname: url.hostname, port: url.port, path, headers, method, signal },
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

async function createFixture(
  observeResponse?: (response: ServerResponse, requestPath: string) => void,
  options: { publicSharing?: boolean } = {},
) {
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
  if (options.publicSharing) preview.previewBaseOrigin = `http://preview.localhost:${port}`
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
  if (observeResponse) {
    server.prependListener("request", (request, response) => {
      observeResponse(response, request.url?.split("?")[0] ?? "")
    })
  }
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
  it("rejects unsupported methods before checking sessions, targets or storage", async () => {
    const { origin, mountPath, save, restore, findPathTargets, findArtifact, storage } =
      await createFixture()
    save("dist/assets/app.css", "private-asset")
    const read = vi.spyOn(storage, "read")

    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await request(
        origin,
        `${mountPath}/assets/app.css`,
        { cookie: "hub_session=member-session" },
        method,
      )

      expect.soft(response.status, method).toBe(404)
    }
    expect(restore).not.toHaveBeenCalled()
    expect(findPathTargets).not.toHaveBeenCalled()
    expect(findArtifact).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it("keeps GET and HEAD available while omitting the HEAD body", async () => {
    const { origin, mountPath, save } = await createFixture()
    save("dist/assets/app.css", "private-asset")
    const headers = { cookie: "hub_session=member-session" }

    const get = await request(origin, `${mountPath}/assets/app.css`, headers, "GET")
    const head = await request(origin, `${mountPath}/assets/app.css`, headers, "HEAD")

    expect(get.status).toBe(200)
    expect(get.body.toString()).toBe("private-asset")
    expect(head.status).toBe(200)
    expect(head.body).toHaveLength(0)
    expect(head.headers["content-length"]).toBe(get.headers["content-length"])
  })

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

  it("serves literal percent filenames without decoding their bytes twice", async () => {
    const { origin, mountPath, save } = await createFixture()
    save("dist/assets/100%complete.bin", "literal percent bytes")
    save("dist/assets/%2f.bin", "literal encoded separator bytes")

    for (const [path, expected] of [
      ["/assets/100%25complete.bin", "literal percent bytes"],
      ["/assets/%252f.bin", "literal encoded separator bytes"],
    ]) {
      const response = await request(origin, `${mountPath}${path}`)
      expect(response.status, path).toBe(200)
      expect(response.body.toString(), path).toBe(expected)
    }
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

  it.each(["session expiry", "repository revocation", "ownership ambiguity"])(
    "rechecks %s before responding to a cached asset request",
    async (change) => {
      const {
        origin,
        mountPath,
        save,
        restore,
        isRepositoryVisible,
        findPathTargets,
        target,
        storage,
      } = await createFixture()
      save("dist/assets/app.css", "private-asset")
      const read = vi.spyOn(storage, "read")
      const first = await request(origin, `${mountPath}/assets/app.css`)
      expect(first.status).toBe(200)
      expect(first.body.toString()).toBe("private-asset")
      expect(first.headers["cache-control"]).toMatch(/\b(?:no-cache|no-store)\b/)
      expect(first.headers.etag).toBeTypeOf("string")
      read.mockClear()

      if (change === "session expiry") restore.mockResolvedValue(null)
      else if (change === "repository revocation") isRepositoryVisible.mockResolvedValue(false)
      else findPathTargets.mockResolvedValue([target, { ...target, buildId: randomUUID() }])
      const denied = await request(origin, `${mountPath}/assets/app.css`, {
        cookie: "hub_session=member-session",
        "if-none-match": first.headers.etag!,
      })

      expect(denied.status).toBe(change === "session expiry" ? 401 : 404)
      expect(denied.body.toString()).not.toContain("private-asset")
      expect(read).not.toHaveBeenCalled()
    },
  )

  it("revalidates immutable assets without storage or source quota and reads mismatched validators", async () => {
    const { origin, mountPath, save, storage } = await createFixture()
    save("dist/assets/app.css", "private-asset")
    const read = vi.spyOn(storage, "read")
    const first = await request(origin, `${mountPath}/assets/app.css`)
    expect(first.status).toBe(200)
    expect(first.headers.etag).toMatch(/^"[^"]+"$/)
    const etag = first.headers.etag!
    read.mockClear()
    const release = reserveBuildPreviewBytes(100 * 1024 * 1024)
    if (!release) throw new Error("The test could not reserve the source-byte budget.")
    try {
      for (const validator of [etag, `"other", W/${etag}`, "*"]) {
        const cached = await request(origin, `${mountPath}/assets/app.css`, {
          cookie: "hub_session=member-session",
          "if-none-match": validator,
        })
        expect(cached.status, validator).toBe(304)
        expect(cached.headers.etag).toBe(etag)
        expect(cached.headers["cache-control"]).toBe("private, no-cache")
        expect(cached.body).toHaveLength(0)
      }
      expect(read).not.toHaveBeenCalled()
    } finally {
      release()
    }
    const changed = await request(origin, `${mountPath}/assets/app.css`, {
      cookie: "hub_session=member-session",
      "if-none-match": '"different-artifact"',
    })
    expect(changed.status).toBe(200)
    expect(changed.headers.etag).toBe(etag)
    expect(changed.body.toString()).toBe("private-asset")
    expect(read).toHaveBeenCalledOnce()
  })

  it("rechecks authorization after a matching artifact lookup before returning 304", async () => {
    const { origin, mountPath, save, findArtifact, isRepositoryVisible, storage } =
      await createFixture()
    save("dist/assets/app.css", "private-asset")
    const first = await request(origin, `${mountPath}/assets/app.css`)
    expect(first.headers.etag).toBeTypeOf("string")
    const lookup = findArtifact.getMockImplementation()!
    findArtifact.mockImplementation(async (id, path) => {
      const artifact = await lookup(id, path)
      isRepositoryVisible.mockResolvedValue(false)
      return artifact
    })
    const read = vi.spyOn(storage, "read")

    const response = await request(origin, `${mountPath}/assets/app.css`, {
      cookie: "hub_session=member-session",
      "if-none-match": first.headers.etag!,
    })
    expect(response.status).toBe(404)
    expect(response.body).toHaveLength(0)
    expect(read).not.toHaveBeenCalled()
  })

  it("does not reuse asset validators for HTML, bridge scripts or private screenshots", async () => {
    const { origin, mountPath, save } = await createFixture()
    save("dist/index.html", "<html><head></head><body>Private document</body></html>")
    save("screenshots/desktop.png", Uint8Array.of(7, 8))
    for (const path of ["/", "/__replica/bridge/v1.js", "/__replica/screenshots/desktop.png"]) {
      const response = await request(origin, `${mountPath}${path}`, {
        cookie: "hub_session=member-session",
        accept: "text/html",
        "if-none-match": "*",
      })
      expect(response.status, path).toBe(200)
      expect(response.body.byteLength, path).toBeGreaterThan(0)
      expect(response.headers.etag, path).toBeUndefined()
    }
  })

  it("serves public-share files under previews before the private mount while retaining revocation", async () => {
    const { origin, mountPath, preview, target, save, readAvailableShareLink } =
      await createFixture(undefined, { publicSharing: true })
    save("dist/previews/app.js", "public preview asset")
    save("dist/index.html", "<html><head></head><body>Public preview SPA</body></html>")
    const shareSession = createSharePreviewSession(
      {
        buildId: target.buildId,
        shareLinkId: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      preview.encryptionKey,
    )
    const headers = {
      host: `${target.buildId}.preview.localhost:${new URL(origin).port}`,
      cookie: `replica_share_preview=${encodeURIComponent(shareSession)}`,
      accept: "text/html",
    }
    const asset = await request(origin, "/previews/app.js", headers)
    const route = await request(origin, "/previews/route", headers)
    expect(asset.status).toBe(200)
    expect(asset.body.toString()).toBe("public preview asset")
    expect(route.status).toBe(200)
    expect(route.body.toString()).toContain("Public preview SPA")

    readAvailableShareLink.mockResolvedValue(null)
    for (const path of ["/previews/app.js", "/previews/route"]) {
      const revoked = await request(origin, path, headers)
      expect(revoked.status).toBe(404)
      expect(revoked.body.toString()).not.toContain("Public preview")
      expect(revoked.body.toString()).not.toContain("Hub shell marker")
    }
    const privateResponse = await request(origin, `${mountPath}/`, { accept: "text/html" })
    expect(privateResponse.status).toBe(401)
    expect(privateResponse.body.toString()).not.toContain("Hub shell marker")
    expect((await request(origin, "/previews/route", { accept: "text/html" })).status).toBe(404)
  })

  it("denies the bridge when the same Build becomes a template during authorization", async () => {
    const { origin, mountPath, preview, target, findPathTargets, findArtifact, storage } =
      await createFixture()
    preview.reviewBridgeSource = 'globalThis.reviewEnabled = "__REPLICA_REVIEW_ENABLED__";'
    findPathTargets
      .mockResolvedValueOnce([target])
      .mockResolvedValue([{ ...target, template: true }])
    const read = vi.spyOn(storage, "read")

    const response = await request(origin, `${mountPath}/__replica/bridge/v1.js`)

    expect(response.status).toBe(404)
    expect(response.body.toString()).not.toContain('globalThis.reviewEnabled = "true"')
    expect(findArtifact).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it("discards a named template screenshot when the same Build loses template eligibility during its read", async () => {
    const { origin, mountPath, target, save, storage, findPathTargets } = await createFixture()
    findPathTargets.mockResolvedValue([{ ...target, template: true }])
    save("screenshots/templates/welcome/desktop.png", Uint8Array.of(7, 8))
    const read = storage.read.bind(storage)
    const reading = vi.spyOn(storage, "read").mockImplementation(async (key) => {
      const result = await read(key)
      findPathTargets.mockResolvedValue([target])
      return result
    })

    const response = await request(
      origin,
      `${mountPath}/__replica/screenshots/templates/welcome/desktop.png`,
    )

    expect(reading).toHaveBeenCalledOnce()
    expect(response.status).toBe(404)
    expect(response.body).toHaveLength(0)
  })

  it.each(["identity", "locality"])(
    "denies a template bridge when repository %s changes without changing the Build",
    async (change) => {
      const { origin, mountPath, target, findPathTargets, isRepositoryVisible } =
        await createFixture()
      const initial = { ...target, template: true }
      const changed = {
        ...initial,
        repository:
          change === "identity"
            ? { ...target.repository, id: randomUUID() }
            : { ...target.repository, local: true },
      }
      isRepositoryVisible.mockImplementation((_viewer, id) =>
        Promise.resolve(id === target.repository.id),
      )
      findPathTargets.mockResolvedValueOnce([initial]).mockResolvedValue([changed])

      const response = await request(origin, `${mountPath}/__replica/bridge/v1.js`)

      expect(response.status).toBe(404)
      expect(response.body).toHaveLength(0)
    },
  )

  it("serves the hosted bridge for an encoded reserved path instead of a stored shadow", async () => {
    const { origin, mountPath, save, findArtifact, storage } = await createFixture()
    save("dist/__replica/bridge/v1.js", "globalThis.shadowedBridge = true")
    const read = vi.spyOn(storage, "read")

    const canonical = await request(origin, `${mountPath}/__replica/bridge/v1.js`)
    const encoded = await request(origin, `${mountPath}/%5f_replica/bridge/v1.js`)

    expect(canonical.status).toBe(200)
    expect(encoded.status).toBe(200)
    expect(encoded.body).toEqual(canonical.body)
    expect(findArtifact).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it.each(["/%5f_replica/unknown", "/__replica"])(
    "rejects reserved path %s before an artifact lookup or SPA fallback",
    async (path) => {
      const { origin, mountPath, save, findArtifact, storage } = await createFixture()
      save("dist/index.html", "<html><head></head><body>Private SPA</body></html>")
      const read = vi.spyOn(storage, "read")

      const response = await request(origin, `${mountPath}${path}`, {
        cookie: "hub_session=member-session",
        accept: "text/html",
      })

      expect(response.status).toBe(404)
      expect(findArtifact).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
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

  it("returns unavailable before reading storage when the process-wide source budget is exhausted", async () => {
    const { origin, mountPath, save, storage, findPathTargets } = await createFixture()
    save("dist/assets/app.css", "private-asset")
    const read = vi.spyOn(storage, "read")
    const release = reserveBuildPreviewBytes(100 * 1024 * 1024)
    if (!release) throw new Error("The test could not reserve the source-byte budget.")

    try {
      const response = await request(origin, `${mountPath}/assets/app.css`)

      expect(findPathTargets).toHaveBeenCalledWith("2001", "3002")
      expect(response.status).toBe(503)
      expect(read).not.toHaveBeenCalled()
    } finally {
      release()
    }
  })

  it("shares the minimum source reservation across private, template and public requests on different servers", async () => {
    const privateRoute = await createFixture()
    const otherRoute = await createFixture(undefined, { publicSharing: true })
    otherRoute.findPathTargets.mockResolvedValue([{ ...otherRoute.target, template: true }])
    privateRoute.save("dist/asset.bin", Uint8Array.of(1))
    otherRoute.save("dist/asset.bin", Uint8Array.of(7))
    const readStarted = deferred<void>()
    const stored = deferred<Awaited<ReturnType<ArtifactStorage["read"]>>>()
    const privateRead = vi.spyOn(privateRoute.storage, "read").mockImplementation(() => {
      readStarted.resolve()
      return stored.promise
    })
    const otherRead = vi.spyOn(otherRoute.storage, "read")
    const shareSession = createSharePreviewSession(
      {
        buildId: otherRoute.target.buildId,
        shareLinkId: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      otherRoute.preview.encryptionKey,
    )
    const publicHeaders = {
      host: `${otherRoute.target.buildId}.preview.localhost:${new URL(otherRoute.origin).port}`,
      cookie: `replica_share_preview=${encodeURIComponent(shareSession)}`,
    }
    const release = reserveBuildPreviewBytes(100 * 1024 * 1024 - 64 * 1024)
    if (!release) throw new Error("The test could not reserve the remaining source bytes.")
    const first = request(privateRoute.origin, `${privateRoute.mountPath}/asset.bin`)

    try {
      await readStarted.promise
      const publicResponse = await request(otherRoute.origin, "/asset.bin", publicHeaders)
      const templateResponse = await request(otherRoute.origin, `${otherRoute.mountPath}/asset.bin`)

      expect.soft(publicResponse.status).toBe(503)
      expect.soft(templateResponse.status).toBe(503)
      expect(otherRead).not.toHaveBeenCalled()
    } finally {
      stored.resolve({ status: "ok", bytes: Uint8Array.of(1) })
      await first
      release()
    }

    expect(privateRead).toHaveBeenCalledOnce()
    expect((await request(otherRoute.origin, "/asset.bin", publicHeaders)).status).toBe(200)
    expect((await request(otherRoute.origin, `${otherRoute.mountPath}/asset.bin`)).status).toBe(200)
  })

  it.each(["finish", "close"] as const)(
    "holds source bytes after response.end until the canonical response emits %s",
    async (completion) => {
      const responsePending = deferred<{ response: ServerResponse; finish: () => void }>()
      const { origin, mountPath, findArtifact, storage } = await createFixture(
        (response, requestPath) => {
          if (!requestPath.endsWith("/slow.bin")) return
          const end = response.end.bind(response)
          vi.spyOn(response, "end").mockImplementation(() => {
            responsePending.resolve({ response, finish: () => end(Uint8Array.of(7)) })
            return response
          })
        },
      )
      findArtifact.mockResolvedValue({
        storageKey: "asset-key",
        byteLength: 100 * 1024 * 1024,
      })
      const read = vi
        .spyOn(storage, "read")
        .mockResolvedValue({ status: "ok", bytes: Uint8Array.of(7) })
      const first = request(origin, `${mountPath}/slow.bin`).catch((error: unknown) => error)
      const pending = await responsePending.promise

      try {
        const blocked = await request(origin, `${mountPath}/asset.bin`)

        expect(blocked.status).toBe(503)
        expect(read).toHaveBeenCalledOnce()
      } finally {
        const completed = once(pending.response, completion)
        if (completion === "finish") pending.finish()
        else pending.response.destroy()
        await completed
        await first
      }

      expect((await request(origin, `${mountPath}/asset.bin`)).status).toBe(200)
      expect(read).toHaveBeenCalledTimes(2)
    },
  )

  it.each(["storage read", "authorization recheck"] as const)(
    "keeps a disconnected canonical request reserved until its pending %s settles",
    async (pendingOperation) => {
      const pendingStarted = deferred<void>()
      const proceed = deferred<void>()
      const disconnected = deferred<void>()
      const { origin, mountPath, findArtifact, storage, isRepositoryVisible } = await createFixture(
        (response, requestPath) => {
          if (requestPath.endsWith("/pending.bin")) {
            response.once("close", () => disconnected.resolve())
          }
        },
      )
      findArtifact.mockResolvedValue({
        storageKey: "asset-key",
        byteLength: 100 * 1024 * 1024,
      })
      const read = vi
        .spyOn(storage, "read")
        .mockResolvedValue({ status: "ok", bytes: Uint8Array.of(7) })
      if (pendingOperation === "storage read") {
        read.mockImplementationOnce(async () => {
          pendingStarted.resolve()
          await proceed.promise
          return { status: "ok", bytes: Uint8Array.of(7) }
        })
      } else {
        isRepositoryVisible.mockResolvedValueOnce(true).mockImplementationOnce(async () => {
          pendingStarted.resolve()
          await proceed.promise
          return true
        })
      }
      const abort = new AbortController()
      const first = request(
        origin,
        `${mountPath}/pending.bin`,
        { cookie: "hub_session=member-session" },
        "GET",
        abort.signal,
      ).catch((error: unknown) => error)

      try {
        await pendingStarted.promise
        abort.abort()
        await disconnected.promise
        const blocked = await request(origin, `${mountPath}/asset.bin`)

        expect(blocked.status).toBe(503)
        expect(read).toHaveBeenCalledOnce()
      } finally {
        proceed.resolve()
        abort.abort()
        await first
      }

      expect((await request(origin, `${mountPath}/asset.bin`)).status).toBe(200)
      expect(read).toHaveBeenCalledTimes(2)
    },
  )

  it.each(["not-found", "unavailable", "error"] as const)(
    "releases the canonical source reservation after storage returns %s",
    async (failure) => {
      const { origin, mountPath, findArtifact, storage } = await createFixture()
      findArtifact.mockResolvedValue({
        storageKey: "asset-key",
        byteLength: 100 * 1024 * 1024,
      })
      const read = vi
        .spyOn(storage, "read")
        .mockResolvedValue({ status: "ok", bytes: Uint8Array.of(7) })
      if (failure === "error") read.mockRejectedValueOnce(new Error("Storage read failed"))
      else read.mockResolvedValueOnce({ status: failure })

      const failed = await request(origin, `${mountPath}/asset.bin`)
      const recovered = await request(origin, `${mountPath}/asset.bin`)

      expect(failed.status).toBe(failure === "not-found" ? 404 : failure === "error" ? 500 : 503)
      expect(recovered.status).toBe(200)
      expect(read).toHaveBeenCalledTimes(2)
    },
  )

  it("releases a temporary template manifest reservation before reserving the SPA document", async () => {
    const { origin, mountPath, findArtifact, storage } = await createFixture()
    const manifest = new TextEncoder().encode(
      JSON.stringify({ templates: [{ path: "/release/v2.0" }] }),
    )
    const html = new TextEncoder().encode("<html><head></head><body>Release notes</body></html>")
    findArtifact.mockImplementation((_buildId, artifactPath) =>
      Promise.resolve(
        artifactPath === "templates.json"
          ? { storageKey: "manifest-key", byteLength: 100 * 1024 * 1024 }
          : artifactPath === "dist/index.html"
            ? { storageKey: "index-key", byteLength: html.byteLength }
            : null,
      ),
    )
    let manifestWasReserved = false
    const read = vi.spyOn(storage, "read").mockImplementation((key) => {
      if (key === "manifest-key") {
        const release = reserveBuildPreviewBytes(1)
        manifestWasReserved = release === null
        release?.()
      }
      return Promise.resolve({ status: "ok", bytes: key === "manifest-key" ? manifest : html })
    })

    const response = await request(origin, `${mountPath}/release/v2.0`, {
      cookie: "hub_session=member-session",
      accept: "text/html",
    })

    expect(response.status).toBe(200)
    expect(manifestWasReserved).toBe(true)
    expect(response.body.toString()).toContain("Release notes")
    expect(read).toHaveBeenNthCalledWith(1, "manifest-key")
    expect(read).toHaveBeenNthCalledWith(2, "index-key")
  })
})
