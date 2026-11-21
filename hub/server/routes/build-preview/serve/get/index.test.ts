import { createHash, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createReadStream } from "node:fs"
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { Readable } from "node:stream"
import { runInNewContext } from "node:vm"
import express, { type ErrorRequestHandler } from "express"
import { describe, expect, it, onTestFinished, vi, type Mock } from "vitest"

import { extractDistPackage } from "../../../../domains/build-artifacts/extract-dist-package"
import { createSharePreviewSession } from "../../../../domains/public-sharing/create-share-preview-session"
import { createZipArchive } from "../../../../test/create-zip-archive"
import type { BuildPreviewRouteDependencies } from "../../types"
import { get } from "."

interface RouteResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
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
    key: Buffer
    dependencies: BuildPreviewRouteDependencies
    findArtifact: Mock<BuildPreviewRouteDependencies["findArtifact"]>
    read: Mock<BuildPreviewRouteDependencies["storage"]["read"]>
    readAvailableShareLink: Mock<
      NonNullable<BuildPreviewRouteDependencies["readAvailableShareLink"]>
    >
    shareCookie: string
  }) => Promise<void>,
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
    findArtifact,
    readAvailableShareLink,
  }
  app.get("/{*path}", get(dependencies))
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
  const shareSession = createSharePreviewSession(
    {
      buildId,
      shareLinkId,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
    key,
  )
  try {
    await operation({
      origin: `http://127.0.0.1:${port}`,
      buildId,
      key,
      dependencies,
      findArtifact,
      read,
      readAvailableShareLink,
      shareCookie: `replica_share_preview=${encodeURIComponent(shareSession)}`,
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
  it("keeps a public share session isolated to its Build origin", async () => {
    await withServeRoute(async ({ origin, shareCookie, findArtifact }) => {
      const response = await request(
        origin,
        "/index.html",
        requestHeaders(randomUUID(), origin, shareCookie),
      )

      expect(response.status).toBe(404)
      expect(findArtifact).not.toHaveBeenCalled()
    })
  })

  it("rejects traversal before looking up an artifact", async () => {
    await withServeRoute(async ({ origin, buildId, shareCookie, findArtifact, read }) => {
      const response = await request(
        origin,
        "/../private.txt",
        requestHeaders(buildId, origin, shareCookie),
      )

      expect(response.status).toBe(404)
      expect(findArtifact).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
    })
  })

  it("falls back to the SPA start document and injects the hosted bridge", async () => {
    await withServeRoute(async ({ origin, buildId, shareCookie, findArtifact, read }) => {
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
        ...requestHeaders(buildId, origin, shareCookie),
        accept: "text/html",
      })

      expect(response.status).toBe(200)
      expect(findArtifact).toHaveBeenNthCalledWith(1, buildId, "dist/checkout/cart")
      expect(findArtifact).toHaveBeenNthCalledWith(2, buildId, "dist/index.html")
      expect(response.body.toString()).toContain(
        '<script src="/__replica/bridge/v1.js"></script></head>',
      )
      expect(response.headers["content-type"]).toBe("text/html; charset=utf-8")
      expect(response.headers["cache-control"]).toBe("private, no-store")
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

  it("serves public assets and local screenshots without reusable caching", async () => {
    await withServeRoute(async ({ origin, buildId, shareCookie, findArtifact, read }) => {
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
      const headers = requestHeaders(buildId, origin, shareCookie)

      const asset = await request(origin, "/assets/app.css", headers)
      const desktop = await request(origin, "/__replica/screenshots/desktop.png", {
        ...headers,
        "if-none-match": "*",
      })
      const narrow = await request(origin, "/__replica/screenshots/narrow.png", {
        ...headers,
        "if-none-match": "*",
      })

      expect(findArtifact).toHaveBeenNthCalledWith(1, buildId, "dist/assets/app.css")
      expect(findArtifact).toHaveBeenNthCalledWith(2, buildId, "screenshots/desktop.png")
      expect(findArtifact).toHaveBeenNthCalledWith(3, buildId, "screenshots/narrow.png")
      expect(asset.headers["content-type"]).toBe("text/css; charset=utf-8")
      expect(desktop.headers["content-type"]).toBe("image/png")
      expect(narrow.headers["content-type"]).toBe("image/png")
      for (const response of [asset, desktop, narrow]) {
        expect(response.status).toBe(200)
        expect(response.headers["cache-control"]).toBe("private, no-store")
        expect(response.body).toEqual(Buffer.from([7, 8]))
      }
      expect(asset.headers["cross-origin-resource-policy"]).toBe("same-origin")
      expect(desktop.headers["cross-origin-resource-policy"]).toBe("same-origin")
      expect(narrow.headers["cross-origin-resource-policy"]).toBe("same-origin")
      expect(desktop.headers.etag).toBeUndefined()
      expect(narrow.headers.etag).toBeUndefined()
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

    await withServeRoute(async ({ origin, buildId, shareCookie, dependencies, findArtifact }) => {
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
        requestHeaders(buildId, origin, shareCookie),
        (chunk) => {
          receivedBytes += chunk.byteLength
          digest.update(chunk)
        },
      )

      expect(response.status).toBe(200)
      expect(response.headers["content-length"]).toBe(String(maximumBytes))
      expect(response.headers["content-type"]).toBe("application/octet-stream")
      expect(response.headers["cache-control"]).toBe("private, no-store")
      expect(receivedBytes).toBe(maximumBytes)
      expect(digest.digest("hex")).toBe(expectedDigest)
    })
  }, 15_000)

  it("disables review behavior in the public preview bridge", async () => {
    await withServeRoute(
      async ({ origin, buildId, shareCookie, dependencies, findArtifact, read }) => {
        dependencies.bridgeSource =
          "globalThis.ReplicaHostedPreviewBridge={installHostedBridge:globalThis.installHostedBridge}"
        const installHostedBridge = vi.fn()
        const response = await request(
          origin,
          "/__replica/bridge/v1.js",
          requestHeaders(buildId, origin, shareCookie),
        )

        expect(response.status).toBe(200)
        expect(response.headers["content-type"]).toMatch(/^text\/javascript/)
        expect(response.headers["cache-control"]).toBe("private, no-store")
        const context = { installHostedBridge, reviewBridge: undefined }
        runInNewContext(response.body.toString(), context)
        expect(context.reviewBridge).toEqual({
          origin: "https://hub.example.com",
          enabled: false,
        })
        expect(installHostedBridge).toHaveBeenCalledExactlyOnceWith("https://hub.example.com", "/")
        expect(findArtifact).not.toHaveBeenCalled()
        expect(read).not.toHaveBeenCalled()
      },
    )
  })

  it("ignores an obsolete private cookie beside a valid public share", async () => {
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

  it("rejects expired public sessions and private cookies without a public share", async () => {
    await withServeRoute(
      async ({ origin, buildId, key, findArtifact, read, readAvailableShareLink }) => {
        const expired = createSharePreviewSession(
          { buildId, shareLinkId: randomUUID(), expiresAt: new Date(Date.now() - 1_000) },
          key,
        )

        for (const cookie of [
          "",
          "hub_session=member-session; replica_preview=obsolete-private-cookie",
          `replica_share_preview=${encodeURIComponent(expired)}`,
        ]) {
          const response = await request(
            origin,
            "/asset.bin",
            requestHeaders(buildId, origin, cookie),
          )
          expect(response.status).toBe(404)
        }
        expect(findArtifact).not.toHaveBeenCalled()
        expect(read).not.toHaveBeenCalled()
        expect(readAvailableShareLink).not.toHaveBeenCalled()
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

  it("stops serving files and bridge scripts after a public link is revoked", async () => {
    await withServeRoute(
      async ({ origin, buildId, shareCookie, readAvailableShareLink, findArtifact, read }) => {
        findArtifact.mockResolvedValue({
          storageKey: "asset-key",
          byteLength: 2,
        })
        read.mockResolvedValue({
          status: "ok",
          bytes: Uint8Array.of(7, 8),
        })
        const headers = requestHeaders(buildId, origin, shareCookie)
        expect((await request(origin, "/asset.bin", headers)).status).toBe(200)
        readAvailableShareLink.mockResolvedValue(null)
        expect((await request(origin, "/asset.bin", headers)).status).toBe(404)
        expect((await request(origin, "/__replica/bridge/v1.js", headers)).status).toBe(404)
        expect(read).toHaveBeenCalledOnce()
      },
    )
  })

  it.each(["not-found", "unavailable", "error"] as const)(
    "releases the source-byte reservation after storage returns %s",
    async (failure) => {
      await withServeRoute(async ({ origin, buildId, shareCookie, findArtifact, read }) => {
        findArtifact.mockResolvedValue({
          storageKey: "asset-key",
          byteLength: 100 * 1024 * 1024,
        })
        read.mockResolvedValue({ status: "ok", bytes: Uint8Array.of(7) })
        if (failure === "error") read.mockRejectedValueOnce(new Error("Storage read failed"))
        else read.mockResolvedValueOnce({ status: failure })
        const headers = requestHeaders(buildId, origin, shareCookie)

        const failed = await request(origin, "/asset.bin", headers)
        const recovered = await request(origin, "/asset.bin", headers)

        expect(failed.status).toBe(failure === "not-found" ? 404 : failure === "error" ? 500 : 503)
        expect(recovered.status).toBe(200)
        expect(read).toHaveBeenCalledTimes(2)
      })
    },
  )
})
