import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi, type Mock } from "vitest"

import { createPreviewGrant } from "../../../../domains/build-preview/create-preview-grant"
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
    dependencies: BuildPreviewRouteDependencies,
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
  const dependencies: BuildPreviewRouteDependencies = {
    applicationOrigin: "https://hub.example.com",
    previewBaseOrigin: `http://preview.localhost:${port}`,
    encryptionKey: key,
    storage: {
      isReady: vi.fn(),
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
    },
    bridgeSource: "",
    findTargetById: findTargetById.mockResolvedValue({
      buildId: randomUUID(),
      startPage: "/checkout?step=shipping#address",
      artifactPath: "dist/index.html",
    }),
    findArtifact: vi.fn(),
  }
  app.get("/__replica/authorize", get(dependencies))
  try {
    await operation(`http://127.0.0.1:${port}`, dependencies, key, findTargetById)
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
    await withAuthorizeRoute(async (origin, _dependencies, key, findTargetById) => {
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
    })
  })
})
