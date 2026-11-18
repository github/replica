import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi, type Mock } from "vitest"

import { createPreviewSession } from "../../../../domains/build-preview/create-preview-session"
import { createSharePreviewSession } from "../../../../domains/public-sharing/create-share-preview-session"
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
      },
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
    }),
    findArtifact,
    readAvailableShareLink,
    restoreSession,
  }
  app.get("/{*path}", get(dependencies))
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
        '<script src="/__replica/bridge/v1.js"></script></head>',
      )
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

  it("serves the generated hosted bridge only to an authorized preview session", async () => {
    await withServeRoute(async ({ origin, buildId, cookie, dependencies, findArtifact, read }) => {
      const response = await request(
        origin,
        "/__replica/bridge/v1.js",
        requestHeaders(buildId, origin, cookie),
      )

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

  it("disables review behavior in the public preview bridge", async () => {
    await withServeRoute(async ({ origin, buildId, shareCookie, dependencies }) => {
      const response = await request(
        origin,
        "/__replica/bridge/v1.js",
        requestHeaders(buildId, origin, shareCookie),
      )

      expect(response.status).toBe(200)
      expect(response.headers["cache-control"]).toBe("private, no-store")
      expect(response.body.toString()).toBe(
        `globalThis.reviewBridge={origin:"https://hub.example.com",enabled:"false" !== "false"};\n${dependencies.bridgeSource};ReplicaHostedPreviewBridge.installHostedBridge("https://hub.example.com");`,
      )
    })
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

  it("distinguishes missing artifact bytes from unavailable storage", async () => {
    await withServeRoute(async ({ origin, buildId, cookie, findArtifact, read }) => {
      findArtifact.mockResolvedValue({
        storageKey: "asset-key",
        byteLength: 1,
      })
      read
        .mockResolvedValueOnce({ status: "not-found" })
        .mockResolvedValueOnce({ status: "unavailable" })
      const headers = requestHeaders(buildId, origin, cookie)

      expect((await request(origin, "/asset.bin", headers)).status).toBe(404)
      expect((await request(origin, "/asset.bin", headers)).status).toBe(503)
    })
  })
})
