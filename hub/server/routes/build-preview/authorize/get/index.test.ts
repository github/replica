import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi, type Mock } from "vitest"

import { createPreviewGrant } from "../../../../domains/build-preview/create-preview-grant"
import { privatePreviewManifestPath } from "../../../../domains/private-preview/types"
import type { BuildPreviewRouteDependencies } from "../../types"
import { get } from "."

async function request(origin: string, path: string, host: string) {
  return new Promise<{
    status: number
    headers: IncomingHttpHeaders
  }>((resolve, reject) => {
    const url = new URL(origin)
    const outgoing = httpRequest(
      { hostname: url.hostname, port: url.port, path, headers: { host } },
      (response) => {
        response.resume()
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers }),
        )
      },
    )
    outgoing.on("error", reject)
    outgoing.end()
  })
}

async function withAuthorizeRoute(
  operation: (
    origin: string,
    mocks: {
      findArtifact: Mock<BuildPreviewRouteDependencies["findArtifact"]>
      read: Mock<BuildPreviewRouteDependencies["storage"]["read"]>
      restoreSession: Mock<NonNullable<BuildPreviewRouteDependencies["restoreSession"]>>
    },
    key: Buffer,
    findTargetById: Mock<BuildPreviewRouteDependencies["findTargetById"]>,
  ) => Promise<void>,
) {
  const key = randomBytes(32)
  const app = express()
  const server = createServer(app)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  const findTargetById = vi.fn<BuildPreviewRouteDependencies["findTargetById"]>()
  const findArtifact = vi
    .fn<BuildPreviewRouteDependencies["findArtifact"]>()
    .mockResolvedValue(null)
  const read = vi.fn<BuildPreviewRouteDependencies["storage"]["read"]>()
  const restoreSession = vi
    .fn<NonNullable<BuildPreviewRouteDependencies["restoreSession"]>>()
    .mockResolvedValue({})
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
    bridgeSource: "",
    findTargetById: findTargetById.mockResolvedValue({
      buildId: randomUUID(),
      startPage: "/checkout?step=shipping#address",
      artifactPath: "dist/index.html",
    }),
    findArtifact,
    restoreSession,
  }
  app.get("/__replica/authorize", get(dependencies))
  try {
    await operation(
      `http://127.0.0.1:${port}`,
      { findArtifact, read, restoreSession },
      key,
      findTargetById,
    )
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe("get()", () => {
  it("exchanges a matching grant for an isolated preview session and start-page redirect", async () => {
    await withAuthorizeRoute(async (origin, _dependencies, key, findTargetById) => {
      const buildId = randomUUID()
      findTargetById.mockResolvedValue({
        buildId,
        startPage: "/checkout?step=shipping#address",
        artifactPath: "dist/index.html",
      })
      const grant = createPreviewGrant(
        {
          buildId,
          target: "preview",
          expiresAt: new Date(Date.now() + 30_000),
          sessionDigest: "a".repeat(64),
        },
        key,
      )

      const response = await request(
        origin,
        `/__replica/authorize?grant=${encodeURIComponent(grant)}`,
        `${buildId}.preview.localhost:${new URL(origin).port}`,
      )

      expect(response.status).toBe(303)
      expect(response.headers.location).toBe("/checkout?step=shipping#address")
      expect(response.headers["set-cookie"]?.[0]).toMatch(
        /^replica_preview=.+; Path=\/; HttpOnly; SameSite=None; Secure; Expires=/,
      )
      expect(response.headers["cache-control"]).toBe("no-store")
      expect(findTargetById).toHaveBeenCalledWith(buildId, "preview")
    })
  })

  it("does not exchange a grant on another Build origin", async () => {
    await withAuthorizeRoute(async (origin, { findArtifact }, key, findTargetById) => {
      const grant = createPreviewGrant(
        {
          buildId: randomUUID(),
          target: "desktop",
          expiresAt: new Date(Date.now() + 30_000),
          sessionDigest: "a".repeat(64),
        },
        key,
      )

      const response = await request(
        origin,
        `/__replica/authorize?grant=${encodeURIComponent(grant)}`,
        `${randomUUID()}.preview.localhost:${new URL(origin).port}`,
      )

      expect(response.status).toBe(404)
      expect(response.headers["set-cookie"]).toBeUndefined()
      expect(findTargetById).not.toHaveBeenCalled()
      expect(findArtifact).not.toHaveBeenCalled()
    })
  })

  it("validates and redirects to a deep route carried outside the grant", async () => {
    await withAuthorizeRoute(async (origin, _dependencies, key, findTargetById) => {
      const buildId = randomUUID()
      findTargetById.mockResolvedValue({
        buildId,
        startPage: "/",
        artifactPath: "dist/index.html",
      })
      const grant = createPreviewGrant(
        {
          buildId,
          target: "preview",
          expiresAt: new Date(Date.now() + 30_000),
          sessionDigest: "a".repeat(64),
        },
        key,
      )
      const host = `${buildId}.preview.localhost:${new URL(origin).port}`

      const valid = await request(
        origin,
        `/__replica/authorize?grant=${encodeURIComponent(grant)}&route=${encodeURIComponent("/checkout?step=shipping#address")}`,
        host,
      )
      expect(valid.status).toBe(303)
      expect(valid.headers.location).toBe("/checkout?step=shipping#address")

      const unsafe = await request(
        origin,
        `/__replica/authorize?grant=${encodeURIComponent(grant)}&route=${encodeURIComponent("https://untrusted.example.com")}`,
        host,
      )
      expect(unsafe.status).toBe(404)
      expect(unsafe.headers["set-cookie"]).toBeUndefined()
    })
  })

  it.each([
    [undefined, "/previews/github/901/1201/"],
    [
      "/checkout?view=%2B&view=summary#order%20details",
      "/previews/github/901/1201/checkout?view=%2B&view=summary#order%20details",
    ],
    [
      "/previews/github/901/1201/checkout?step=shipping#address",
      "/previews/github/901/1201/checkout?step=shipping#address",
    ],
    [
      "/previews/github/901/1201?step=shipping#address",
      "/previews/github/901/1201/?step=shipping#address",
    ],
  ])("launches a marked Build at %s within its declared mount", async (route, destination) => {
    await withAuthorizeRoute(async (origin, { findArtifact, read }, key, findTargetById) => {
      const buildId = randomUUID()
      findTargetById.mockResolvedValue({ buildId, startPage: "/", artifactPath: "dist/index.html" })
      const bytes = Buffer.from(JSON.stringify({ basePath: "/previews/github/901/1201/" }))
      findArtifact.mockResolvedValue({
        storageKey: "base-marker",
        byteLength: bytes.length,
      })
      read.mockResolvedValue({ status: "ok", bytes })
      const grant = createPreviewGrant(
        {
          buildId,
          target: "preview",
          expiresAt: new Date(Date.now() + 30_000),
          sessionDigest: "a".repeat(64),
        },
        key,
      )
      const query = new URLSearchParams({ grant })
      if (route !== undefined) query.set("route", route)
      const response = await request(
        origin,
        `/__replica/authorize?${query}`,
        `${buildId}.preview.localhost:${new URL(origin).port}`,
      )

      expect(response.status).toBe(303)
      expect(response.headers.location).toBe(destination)
      expect(findArtifact).toHaveBeenCalledWith(buildId, privatePreviewManifestPath)
      expect(read).toHaveBeenCalledWith("base-marker")
    })
  })

  it.each([
    ["oversized metadata", 257, "/previews/github/901/1201/", false],
    ["noncanonical mount", undefined, "/previews/github/0901/1201/", true],
    ["mismatched byte length", 1, "/previews/github/901/1201/", true],
  ])(
    "ignores a retained declaration with %s",
    async (_reason, byteLength, basePath, readsStorage) => {
      await withAuthorizeRoute(async (origin, { findArtifact, read }, key, findTargetById) => {
        const buildId = randomUUID()
        const startPage = "/checkout?step=shipping#address"
        findTargetById.mockResolvedValue({ buildId, startPage, artifactPath: "dist/index.html" })
        const bytes = Buffer.from(JSON.stringify({ basePath }))
        findArtifact.mockResolvedValue({
          storageKey: "base-marker",
          byteLength: byteLength ?? bytes.length,
        })
        read.mockResolvedValue({ status: "ok", bytes })
        const grant = createPreviewGrant(
          {
            buildId,
            target: "preview",
            expiresAt: new Date(Date.now() + 30_000),
            sessionDigest: "a".repeat(64),
          },
          key,
        )

        const response = await request(
          origin,
          `/__replica/authorize?${new URLSearchParams({ grant })}`,
          `${buildId}.preview.localhost:${new URL(origin).port}`,
        )

        expect(response.status).toBe(303)
        expect(response.headers.location).toBe(startPage)
        expect(read).toHaveBeenCalledTimes(readsStorage ? 1 : 0)
      })
    },
  )

  it.each([
    ["desktop", undefined, "screenshots/desktop.png"],
    [
      "template",
      "screenshots/templates/checkout/desktop.png",
      "screenshots/templates/checkout/desktop.png",
    ],
  ] as const)(
    "keeps %s screenshots off the mount lookup",
    async (target, screenshotPath, destination) => {
      await withAuthorizeRoute(
        async (origin, { findArtifact, read, restoreSession }, key, findTargetById) => {
          const buildId = randomUUID()
          findTargetById.mockResolvedValue({ buildId, startPage: "/", artifactPath: destination })
          findArtifact.mockResolvedValue({
            storageKey: "screenshot",
            byteLength: 10,
          })
          const grant = createPreviewGrant(
            {
              buildId,
              target,
              ...(screenshotPath ? { screenshotPath } : {}),
              expiresAt: new Date(Date.now() + 30_000),
              sessionDigest: "a".repeat(64),
            },
            key,
          )

          const response = await request(
            origin,
            `/__replica/authorize?${new URLSearchParams({ grant })}`,
            `${buildId}.preview.localhost:${new URL(origin).port}`,
          )

          expect(response.status).toBe(303)
          expect(response.headers.location).toBe(`/__replica/${destination}`)
          expect(findArtifact).not.toHaveBeenCalledWith(buildId, privatePreviewManifestPath)
          expect(read).not.toHaveBeenCalled()
          expect(restoreSession).not.toHaveBeenCalled()
        },
      )
    },
  )

  it.each(["session revoked", "target removed"] as const)(
    "does not issue a preview session when %s during the marker lookup",
    async (change) => {
      await withAuthorizeRoute(
        async (origin, { findArtifact, read, restoreSession }, key, findTargetById) => {
          const buildId = randomUUID()
          findTargetById.mockResolvedValue({
            buildId,
            startPage: "/",
            artifactPath: "dist/index.html",
          })
          const bytes = Buffer.from(JSON.stringify({ basePath: "/previews/github/901/1201/" }))
          findArtifact.mockResolvedValue({ storageKey: "base-marker", byteLength: bytes.length })
          read.mockImplementation(() => {
            if (change === "session revoked") restoreSession.mockResolvedValue(null)
            else findTargetById.mockResolvedValue(null)
            return Promise.resolve({ status: "ok", bytes })
          })
          const grant = createPreviewGrant(
            {
              buildId,
              target: "preview",
              expiresAt: new Date(Date.now() + 30_000),
              sessionDigest: "a".repeat(64),
            },
            key,
          )

          const response = await request(
            origin,
            `/__replica/authorize?${new URLSearchParams({ grant })}`,
            `${buildId}.preview.localhost:${new URL(origin).port}`,
          )

          expect(response.status).toBe(404)
          expect(response.headers.location).toBeUndefined()
          expect(response.headers["set-cookie"]).toBeUndefined()
        },
      )
    },
  )
})
