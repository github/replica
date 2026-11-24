import { createHash, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createReadStream } from "node:fs"
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises"
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { Readable } from "node:stream"
import express, { type ErrorRequestHandler } from "express"
import { describe, expect, it, onTestFinished, vi, type Mock } from "vitest"

import { extractDistPackage } from "../../../../domains/build-artifacts/extract-dist-package"
import { createPreviewSession } from "../../../../domains/build-preview/create-preview-session"
import { createSharePreviewSession } from "../../../../domains/public-sharing/create-share-preview-session"
import { createZipArchive } from "../../../../test/create-zip-archive"
import type { BuildPreviewRouteDependencies } from "../../types"
import { get } from "."

interface RouteResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

const BRIDGE_PATHS = [
  "/__replica/bridge/v1.js",
  "/__replica/bridge/v2.js",
  "/__replica/bridge/v3.js",
]

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
  headers: Record<string, string>,
  consume?: (chunk: Buffer) => void,
  signal?: AbortSignal,
): Promise<RouteResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(origin)
    const outgoing = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        method: "GET",
        headers,
        signal,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => {
          if (consume) consume(chunk)
          else chunks.push(chunk)
        })
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

async function withServeRoute(
  operation: (input: {
    origin: string
    buildId: string
    cookie: string
    dependencies: BuildPreviewRouteDependencies
    findArtifact: Mock<BuildPreviewRouteDependencies["findArtifact"]>
    read: Mock<BuildPreviewRouteDependencies["storage"]["read"]>
    readAvailableShareLink: Mock<
      NonNullable<BuildPreviewRouteDependencies["readAvailableShareLink"]>
    >
    restoreSession: Mock<NonNullable<BuildPreviewRouteDependencies["restoreSession"]>>
    shareCookie: string
    templateCookie: string
  }) => Promise<void>,
  observeResponse?: (response: ServerResponse, requestPath: string) => void,
) {
  const key = randomBytes(32)
  const buildId = randomUUID()
  const shareLinkId = randomUUID()
  const app = express()
  const server = createServer(app)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  const read = vi.fn<BuildPreviewRouteDependencies["storage"]["read"]>()
  const findArtifact = vi.fn<BuildPreviewRouteDependencies["findArtifact"]>()
  const readAvailableShareLink = vi
    .fn<NonNullable<BuildPreviewRouteDependencies["readAvailableShareLink"]>>()
    .mockResolvedValue({
      expiresAt: new Date(Date.now() + 60 * 60_000),
      startPage: "/",
    })
  const restoreSession = vi
    .fn<NonNullable<BuildPreviewRouteDependencies["restoreSession"]>>()
    .mockResolvedValue({ userId: randomUUID() })
  const dependencies: BuildPreviewRouteDependencies = {
    applicationOrigin: "https://hub.example.com",
    previewBaseOrigin: `http://preview.localhost:${port}`,
    encryptionKey: key,
    storage: {
      isReady: vi.fn(),
      read,
      write: vi.fn(),
      delete: vi.fn(),
    },
    bridgeSource: "globalThis.ReplicaHostedPreviewBridge={installHostedBridge(origin){}}",
    reviewBridgeSource:
      'globalThis.reviewBridge={origin:"__REPLICA_HUB_ORIGIN__",enabled:"__REPLICA_REVIEW_ENABLED__" !== "false"};',
    findTargetById: vi.fn().mockResolvedValue({
      buildId,
      startPage: "/",
      artifactPath: "dist/index.html",
      templateRepository: { id: randomUUID(), local: true },
    }),
    findArtifact,
    readAvailableShareLink,
    restoreSession,
  }
  app.use((request, response, next) => {
    observeResponse?.(response, request.path)
    next()
  })
  app.get(
    "/{*path}",
    get(dependencies, () => Promise.resolve(true)),
  )
  function handleError(
    error: unknown,
    _request: Parameters<ErrorRequestHandler>[1],
    response: Parameters<ErrorRequestHandler>[2],
    next: Parameters<ErrorRequestHandler>[3],
  ) {
    if (response.headersSent) {
      next(error)
      return
    }
    response.status(500).end()
  }
  app.use(handleError)
  const session = createPreviewSession(
    buildId,
    "a".repeat(64),
    new Date(Date.now() + 15 * 60_000),
    key,
  )
  const shareSession = createSharePreviewSession(
    {
      buildId,
      shareLinkId,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
    key,
  )
  const templateSession = createPreviewSession(
    buildId,
    "b".repeat(64),
    new Date(Date.now() + 15 * 60_000),
    key,
    true,
  )
  try {
    await operation({
      origin: `http://127.0.0.1:${port}`,
      buildId,
      cookie: `replica_preview=${encodeURIComponent(session)}`,
      dependencies,
      findArtifact,
      read,
      readAvailableShareLink,
      restoreSession,
      shareCookie: `replica_share_preview=${encodeURIComponent(shareSession)}`,
      templateCookie: `replica_preview=${encodeURIComponent(templateSession)}`,
    })
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

function requestHeaders(buildId: string, origin: string, cookie: string) {
  return {
    host: `${buildId}.preview.localhost:${new URL(origin).port}`,
    cookie,
  }
}

describe("get()", () => {
  it("keeps a preview session isolated to its Build origin", async () => {
    await withServeRoute(async ({ origin, cookie, findArtifact }) => {
      const response = await request(
        origin,
        "/index.html",
        requestHeaders(randomUUID(), origin, cookie),
      )

      expect(response.status).toBe(404)
      expect(findArtifact).not.toHaveBeenCalled()
    })
  })

  it("rejects traversal before looking up an artifact", async () => {
    await withServeRoute(async ({ origin, buildId, cookie, findArtifact, read }) => {
      const response = await request(
        origin,
        "/../private.txt",
        requestHeaders(buildId, origin, cookie),
      )

      expect(response.status).toBe(404)
      expect(findArtifact).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
    })
  })

  it("falls back to the SPA start document and injects the hosted bridge", async () => {
    await withServeRoute(async ({ origin, buildId, cookie, findArtifact, read }) => {
      const source = new TextEncoder().encode(
        "<!doctype html><html><head><title>Checkout</title></head><body></body></html>",
      )
      findArtifact.mockResolvedValueOnce(null).mockResolvedValueOnce({
        storageKey: "index-key",
        byteLength: source.byteLength,
      })
      read.mockResolvedValue({
        status: "ok",
        bytes: source,
      })

      const response = await request(origin, "/checkout/cart", {
        ...requestHeaders(buildId, origin, cookie),
        accept: "text/html",
      })

      expect(response.status).toBe(200)
      expect(findArtifact).toHaveBeenNthCalledWith(1, buildId, "dist/checkout/cart")
      expect(findArtifact).toHaveBeenNthCalledWith(2, buildId, "dist/index.html")
      expect(response.body.toString()).toContain(
        '<script src="/__replica/bridge/v3.js" data-replica-preview-mount=""></script></head>',
      )
      expect(response.body.toString()).not.toContain("/__replica/bridge/v1.js")
      expect(response.headers["content-type"]).toBe("text/html; charset=utf-8")
      expect(response.headers["cache-control"]).toBe("private, no-cache")
      expect(response.headers["content-length"]).toBe(String(response.body.byteLength))
      expect(response.headers["content-security-policy"]).toContain(
        "frame-ancestors https://hub.example.com",
      )
      expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin")
      expect(response.headers["permissions-policy"]).toBe(
        "camera=(), microphone=(), geolocation=()",
      )
      expect(response.headers["referrer-policy"]).toBe("no-referrer")
      expect(response.headers["x-content-type-options"]).toBe("nosniff")
    })
  })

  it("serves immutable assets and both named screenshots with path-derived content types", async () => {
    await withServeRoute(async ({ origin, buildId, cookie, findArtifact, read }) => {
      findArtifact.mockImplementation((_buildId, path) =>
        Promise.resolve({
          storageKey: path,
          byteLength: 2,
        }),
      )
      read.mockResolvedValue({
        status: "ok",
        bytes: Uint8Array.of(7, 8),
      })
      const headers = requestHeaders(buildId, origin, cookie)

      const asset = await request(origin, "/assets/app.css", headers)
      const desktop = await request(origin, "/__replica/screenshots/desktop.png", headers)
      const narrow = await request(origin, "/__replica/screenshots/narrow.png", headers)

      expect(findArtifact).toHaveBeenNthCalledWith(1, buildId, "dist/assets/app.css")
      expect(findArtifact).toHaveBeenNthCalledWith(2, buildId, "screenshots/desktop.png")
      expect(findArtifact).toHaveBeenNthCalledWith(3, buildId, "screenshots/narrow.png")
      expect(asset.headers["content-type"]).toBe("text/css; charset=utf-8")
      expect(desktop.headers["content-type"]).toBe("image/png")
      expect(narrow.headers["content-type"]).toBe("image/png")
      for (const response of [asset, desktop, narrow]) {
        expect(response.status).toBe(200)
        expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable")
        expect(response.body).toEqual(Buffer.from([7, 8]))
      }
      expect(asset.headers["cross-origin-resource-policy"]).toBe("same-origin")
      expect(desktop.headers["cross-origin-resource-policy"]).toBe("cross-origin")
      expect(narrow.headers["cross-origin-resource-policy"]).toBe("cross-origin")
    })
  })

  it("serves a packaged 100 MiB asset through ZIP import and immutable Azure artifact storage", async () => {
    const root = await mkdtemp(path.resolve(".preview-static-file-test-"))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const maximumBytes = 100 * 1024 * 1024
    await mkdir(path.join(root, "dist/assets"), { recursive: true })
    await writeFile(path.join(root, "dist/index.html"), "")
    const assetPath = path.join(root, "dist/assets/data.bin")
    const asset = await open(assetPath, "w")
    try {
      await asset.truncate(maximumBytes)
      await asset.write(Buffer.from("first"), 0, 5, 0)
      await asset.write(Buffer.from("last"), 0, 4, maximumBytes - 4)
    } finally {
      await asset.close()
    }
    const sourceDigest = createHash("sha256")
    const source = createReadStream(assetPath) as AsyncIterable<Buffer>
    for await (const chunk of source) sourceDigest.update(chunk)
    const expectedDigest = sourceDigest.digest("hex")
    const packageModule = new URL(
      "../../../../../../actions/build/scripts/create-dist-package/index.mjs",
      import.meta.url,
    ).href
    const { createDistPackage } = (await import(packageModule)) as {
      createDistPackage: (root: string, configRoot: string, output: string) => Promise<number>
    }
    const output = path.join(root, "package")
    await createDistPackage(root, root, output)
    const archive = createZipArchive(
      await Promise.all(
        ["dist/index.html", "dist/assets/data.bin"].map(async (name) => ({
          name,
          bytes: await readFile(path.join(output, name)),
        })),
      ),
    )
    const imported = extractDistPackage(archive)
    const importedAsset = imported.files.find((file) => file.path === "dist/assets/data.bin")!
    const blobs = new Map<string, Uint8Array>()
    vi.doMock("@azure/identity", () => ({ ManagedIdentityCredential: class {} }))
    vi.doMock("@azure/storage-blob", () => ({
      BlobServiceClient: class {
        getContainerClient() {
          return {
            getBlockBlobClient(key: string) {
              return {
                uploadData(bytes: Uint8Array, options: { conditions: { ifNoneMatch: string } }) {
                  if (options.conditions.ifNoneMatch === "*" && blobs.has(key)) {
                    return Promise.reject(
                      Object.assign(new Error("The immutable blob already exists."), {
                        details: { errorCode: "ConditionNotMet" },
                      }),
                    )
                  }
                  blobs.set(key, bytes)
                  return Promise.resolve()
                },
                download() {
                  const bytes = blobs.get(key)!
                  return Promise.resolve({
                    contentLength: bytes.byteLength,
                    readableStreamBody: Readable.from(
                      (function* () {
                        for (let offset = 0; offset < bytes.byteLength; offset += 1024 * 1024) {
                          yield bytes.subarray(offset, offset + 1024 * 1024)
                        }
                      })(),
                    ),
                  })
                },
              }
            },
          }
        }
      },
    }))
    onTestFinished(() => {
      vi.doUnmock("@azure/identity")
      vi.doUnmock("@azure/storage-blob")
    })
    const { createArtifactStorage } =
      await import("../../../../domains/artifacts/create-artifact-storage")
    const storage = await createArtifactStorage({
      provider: "azure-blob",
      accountUrl: "https://example.blob.core.windows.net",
      container: "artifacts",
    })
    expect(await storage.write("asset-key", importedAsset.bytes)).toEqual({ status: "ok" })
    expect(await storage.write("asset-key", Uint8Array.of(9))).toEqual({
      status: "already-exists",
    })

    await withServeRoute(async ({ origin, buildId, cookie, dependencies, findArtifact }) => {
      dependencies.storage = storage
      findArtifact.mockImplementation((_buildId, artifactPath) =>
        Promise.resolve(
          artifactPath === "dist/assets/data.bin"
            ? { storageKey: "asset-key", byteLength: importedAsset.bytes.byteLength }
            : null,
        ),
      )
      let receivedBytes = 0
      const digest = createHash("sha256")

      const response = await request(
        origin,
        "/assets/data.bin",
        requestHeaders(buildId, origin, cookie),
        (chunk) => {
          receivedBytes += chunk.byteLength
          digest.update(chunk)
        },
      )

      expect(response.status).toBe(200)
      expect(response.headers["content-length"]).toBe(String(maximumBytes))
      expect(response.headers["content-type"]).toBe("application/octet-stream")
      expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable")
      expect(receivedBytes).toBe(maximumBytes)
      expect(digest.digest("hex")).toBe(expectedDigest)
    })
  }, 15_000)

  it("shares the source-byte limit across private, public, and template requests on different Build servers", async () => {
    await withServeRoute(async (privateRoute) => {
      await withServeRoute(async (publicRoute) => {
        const readStarted = deferred<void>()
        const stored =
          deferred<Awaited<ReturnType<BuildPreviewRouteDependencies["storage"]["read"]>>>()
        privateRoute.findArtifact.mockResolvedValue({
          storageKey: "private-asset",
          byteLength: 100 * 1024 * 1024,
        })
        privateRoute.read.mockImplementation(() => {
          readStarted.resolve()
          return stored.promise
        })
        publicRoute.findArtifact.mockImplementation((_buildId, artifactPath) =>
          Promise.resolve(
            artifactPath === "dist/asset.bin" || artifactPath === "templates.json"
              ? { storageKey: "public-asset", byteLength: 1 }
              : null,
          ),
        )
        publicRoute.read.mockResolvedValue({ status: "ok", bytes: Uint8Array.of(7) })
        const first = request(
          privateRoute.origin,
          "/asset.bin",
          requestHeaders(privateRoute.buildId, privateRoute.origin, privateRoute.cookie),
        )

        try {
          await readStarted.promise
          const blocked = await request(
            publicRoute.origin,
            "/asset.bin",
            requestHeaders(publicRoute.buildId, publicRoute.origin, publicRoute.shareCookie),
          )
          const blockedTemplate = await request(publicRoute.origin, "/release/v2.0", {
            ...requestHeaders(publicRoute.buildId, publicRoute.origin, publicRoute.templateCookie),
            accept: "text/html",
          })

          expect(blocked.status).toBe(503)
          expect(blockedTemplate.status).toBe(503)
          expect(publicRoute.read).not.toHaveBeenCalled()
        } finally {
          stored.resolve({ status: "ok", bytes: Uint8Array.of(1) })
          expect((await first).status).toBe(200)
        }

        const recovered = await request(
          publicRoute.origin,
          "/asset.bin",
          requestHeaders(publicRoute.buildId, publicRoute.origin, publicRoute.shareCookie),
        )
        expect(recovered.status).toBe(200)
        expect(publicRoute.read).toHaveBeenCalledOnce()
      })
    })
  })

  it.each(["finish", "close"] as const)(
    "holds source bytes after reading until the response emits %s",
    async (completion) => {
      const responsePending = deferred<{
        response: ServerResponse
        finish: () => void
      }>()
      await withServeRoute(
        async ({ origin, buildId, cookie, findArtifact, read }) => {
          findArtifact.mockResolvedValue({
            storageKey: "asset-key",
            byteLength: 100 * 1024 * 1024,
          })
          read.mockResolvedValue({ status: "ok", bytes: Uint8Array.of(7) })
          const headers = requestHeaders(buildId, origin, cookie)
          const first = request(origin, "/slow.bin", headers).catch((error: unknown) => error)
          const pending = await responsePending.promise

          try {
            const blocked = await request(origin, "/asset.bin", headers)

            expect(blocked.status).toBe(503)
            expect(read).toHaveBeenCalledOnce()
          } finally {
            const completed = once(pending.response, completion)
            if (completion === "finish") pending.finish()
            else pending.response.destroy()
            await completed
            await first
          }

          expect((await request(origin, "/asset.bin", headers)).status).toBe(200)
          expect(read).toHaveBeenCalledTimes(2)
        },
        (response, requestPath) => {
          if (requestPath !== "/slow.bin") return
          const end = response.end.bind(response)
          vi.spyOn(response, "end").mockImplementation(() => {
            responsePending.resolve({ response, finish: () => end(Uint8Array.of(7)) })
            return response
          })
        },
      )
    },
  )

  it.each(["storage read", "authorization recheck"] as const)(
    "keeps a disconnected request reserved until its pending %s settles",
    async (pendingOperation) => {
      const pendingStarted = deferred<void>()
      const proceed = deferred<void>()
      const disconnected = deferred<void>()
      await withServeRoute(
        async ({ origin, buildId, cookie, findArtifact, read, restoreSession }) => {
          findArtifact.mockResolvedValue({
            storageKey: "asset-key",
            byteLength: 100 * 1024 * 1024,
          })
          read.mockResolvedValue({ status: "ok", bytes: Uint8Array.of(7) })
          if (pendingOperation === "storage read") {
            read.mockImplementationOnce(async () => {
              pendingStarted.resolve()
              await proceed.promise
              return { status: "ok", bytes: Uint8Array.of(7) }
            })
          }
          if (pendingOperation === "authorization recheck") {
            restoreSession
              .mockResolvedValueOnce({ userId: randomUUID() })
              .mockImplementationOnce(async () => {
                pendingStarted.resolve()
                await proceed.promise
                return { userId: randomUUID() }
              })
          }
          const headers = requestHeaders(buildId, origin, cookie)
          const abort = new AbortController()
          const first = request(origin, "/pending.bin", headers, undefined, abort.signal).catch(
            (error: unknown) => error,
          )

          try {
            await pendingStarted.promise
            abort.abort()
            await disconnected.promise
            const blocked = await request(origin, "/asset.bin", headers)

            expect(blocked.status).toBe(503)
            expect(read).toHaveBeenCalledOnce()
          } finally {
            proceed.resolve()
            abort.abort()
            await first
          }

          expect((await request(origin, "/asset.bin", headers)).status).toBe(200)
          expect(read).toHaveBeenCalledTimes(2)
        },
        (response, requestPath) => {
          if (requestPath === "/pending.bin") {
            response.once("close", () => disconnected.resolve())
          }
        },
      )
    },
  )

  it("releases the template manifest reservation before reading the SPA entry point", async () => {
    await withServeRoute(async ({ origin, buildId, cookie, findArtifact, read }) => {
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
      read.mockImplementation((key) =>
        Promise.resolve({ status: "ok", bytes: key === "manifest-key" ? manifest : html }),
      )

      const response = await request(origin, "/release/v2.0", {
        ...requestHeaders(buildId, origin, cookie),
        accept: "text/html",
      })

      expect(response.status).toBe(200)
      expect(response.body.toString()).toContain("Release notes")
      expect(read).toHaveBeenNthCalledWith(1, "manifest-key")
      expect(read).toHaveBeenNthCalledWith(2, "index-key")
    })
  })

  it.each(BRIDGE_PATHS)("serves %s to a private preview with review and Controls", async (path) => {
    await withServeRoute(async ({ origin, buildId, cookie, dependencies, findArtifact, read }) => {
      const response = await request(origin, path, requestHeaders(buildId, origin, cookie))

      expect(response.status).toBe(200)
      expect(response.headers["content-type"]).toMatch(/^text\/javascript/)
      expect(response.headers["cache-control"]).toBe("private, max-age=300")
      expect(response.body.toString()).toBe(
        `globalThis.reviewBridge={origin:"https://hub.example.com",enabled:"true" !== "false"};\n${dependencies.bridgeSource};ReplicaHostedPreviewBridge.installHostedBridge("https://hub.example.com");`,
      )
      expect(findArtifact).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
    })
  })

  it.each(BRIDGE_PATHS)(
    "serves %s without review and with the original cache policy for public shares and templates",
    async (path) => {
      await withServeRoute(
        async ({ origin, buildId, shareCookie, templateCookie, dependencies }) => {
          const browseSource = `globalThis.reviewBridge={origin:"https://hub.example.com",enabled:"false" !== "false"};\n${dependencies.bridgeSource};ReplicaHostedPreviewBridge.installHostedBridge("https://hub.example.com");`
          for (const [cookie, cacheControl] of [
            [shareCookie, "private, no-store"],
            [templateCookie, "private, max-age=300"],
          ] as const) {
            const response = await request(origin, path, requestHeaders(buildId, origin, cookie))
            expect(response.status).toBe(200)
            expect(response.headers["cache-control"]).toBe(cacheControl)
            expect(response.body.toString()).toBe(browseSource)
          }
        },
      )
    },
  )

  it.each(BRIDGE_PATHS)("denies %s without live preview authority", async (path) => {
    await withServeRoute(
      async ({ origin, buildId, cookie, shareCookie, restoreSession, readAvailableShareLink }) => {
        restoreSession.mockResolvedValue(null)
        readAvailableShareLink.mockResolvedValue(null)

        for (const sessionCookie of ["", cookie, shareCookie]) {
          const response = await request(
            origin,
            path,
            requestHeaders(buildId, origin, sessionCookie),
          )
          expect(response.status).toBe(404)
          expect(response.body.byteLength).toBe(0)
        }
      },
    )
  })

  it("keeps a valid public share separate from an invalid authenticated preview cookie", async () => {
    await withServeRoute(
      async ({ origin, buildId, shareCookie, findArtifact, read, readAvailableShareLink }) => {
        findArtifact.mockResolvedValue({
          storageKey: "asset-key",
          byteLength: 2,
        })

        read.mockResolvedValue({
          status: "ok",
          bytes: Uint8Array.of(7, 8),
        })

        const response = await request(origin, "/asset.bin", {
          ...requestHeaders(buildId, origin, `${shareCookie}; replica_preview=invalid`),
        })

        expect(response.status).toBe(200)
        expect(response.headers["cache-control"]).toBe("private, no-store")
        expect(readAvailableShareLink).toHaveBeenCalledTimes(2)
      },
    )
  })

  it("falls back to a public session when a valid private cookie lost live authority", async () => {
    await withServeRoute(
      async ({
        origin,
        buildId,
        cookie,
        shareCookie,
        restoreSession,
        findArtifact,
        read,
        readAvailableShareLink,
      }) => {
        restoreSession.mockResolvedValue(null)
        findArtifact.mockResolvedValue({
          storageKey: "asset-key",
          byteLength: 2,
        })
        read.mockResolvedValue({
          status: "ok",
          bytes: Uint8Array.of(7, 8),
        })

        const response = await request(
          origin,
          "/asset.bin",
          requestHeaders(buildId, origin, `${cookie}; ${shareCookie}`),
        )

        expect(response.status).toBe(200)
        expect(response.headers["cache-control"]).toBe("private, no-store")
        expect(readAvailableShareLink).toHaveBeenCalledTimes(2)
      },
    )
  })

  it("rechecks public availability after reading artifact bytes", async () => {
    await withServeRoute(
      async ({ origin, buildId, shareCookie, findArtifact, read, readAvailableShareLink }) => {
        findArtifact.mockResolvedValue({
          storageKey: "asset-key",
          byteLength: 2,
        })

        read.mockResolvedValue({
          status: "ok",
          bytes: Uint8Array.of(7, 8),
        })
        readAvailableShareLink
          .mockResolvedValueOnce({
            expiresAt: new Date(Date.now() + 60 * 60_000),
            startPage: "/",
          })
          .mockResolvedValueOnce(null)

        const response = await request(
          origin,
          "/asset.bin",
          requestHeaders(buildId, origin, shareCookie),
        )

        expect(response.status).toBe(404)
        expect(response.body).toHaveLength(0)
        expect(read).toHaveBeenCalledOnce()
        expect(readAvailableShareLink).toHaveBeenCalledTimes(2)
      },
    )
  })

  it("rechecks private session and repository authority after reading artifact bytes", async () => {
    await withServeRoute(
      async ({ origin, buildId, cookie, restoreSession, findArtifact, read }) => {
        findArtifact.mockResolvedValue({
          storageKey: "asset-key",
          byteLength: 2,
        })
        read.mockResolvedValue({
          status: "ok",
          bytes: Uint8Array.of(7, 8),
        })
        restoreSession.mockResolvedValueOnce({ userId: randomUUID() }).mockResolvedValueOnce(null)

        const response = await request(
          origin,
          "/asset.bin",
          requestHeaders(buildId, origin, cookie),
        )

        expect(response.status).toBe(404)
        expect(read).toHaveBeenCalledOnce()
      },
    )
  })

  it.each(["not-found", "unavailable", "error"] as const)(
    "releases the source-byte reservation after storage returns %s",
    async (failure) => {
      await withServeRoute(async ({ origin, buildId, cookie, findArtifact, read }) => {
        findArtifact.mockResolvedValue({
          storageKey: "asset-key",
          byteLength: 100 * 1024 * 1024,
        })
        read.mockResolvedValue({ status: "ok", bytes: Uint8Array.of(7) })
        if (failure === "error") read.mockRejectedValueOnce(new Error("Storage read failed"))
        else read.mockResolvedValueOnce({ status: failure })
        const headers = requestHeaders(buildId, origin, cookie)

        const failed = await request(origin, "/asset.bin", headers)
        const recovered = await request(origin, "/asset.bin", headers)

        expect(failed.status).toBe(failure === "not-found" ? 404 : failure === "error" ? 500 : 503)
        expect(recovered.status).toBe(200)
        expect(read).toHaveBeenCalledTimes(2)
      })
    },
  )
})
