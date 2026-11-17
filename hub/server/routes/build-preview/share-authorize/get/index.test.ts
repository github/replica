import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi, type Mock } from "vitest"

import { createSharePreviewGrant } from "../../../../domains/public-sharing/create-share-preview-grant"
import type { PublicSharingRouteDependencies } from "../../../api/public-sharing/types"
import type { BuildPreviewRouteDependencies } from "../../types"
import { get } from "."

async function request(
  origin: string,
  path: string,
  host: string,
  cookie?: string,
): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const url = new URL(origin)
    const outgoing = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        headers: { host, ...(cookie ? { cookie } : {}) },
      },
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

async function withRoute(
  operation: (input: {
    origin: string
    key: Buffer
    buildId: string
    shareLinkId: string
    readAvailableLink: Mock<PublicSharingRouteDependencies["readAvailableLink"]>
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
  const readAvailableLink = vi
    .fn<PublicSharingRouteDependencies["readAvailableLink"]>()
    .mockResolvedValue({
      expiresAt: new Date(Date.now() + 60 * 60_000),
      startPage: "/checkout?step=shipping#address",
    })
  const preview: BuildPreviewRouteDependencies = {
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
    findTargetById: vi.fn(),
    findArtifact: vi.fn(),
  }
  const sharing: PublicSharingRouteDependencies = {
    applicationOrigin: "https://hub.example.com",
    previewBaseOrigin: `http://preview.localhost:${port}`,
    maximumDays: 7,
    getSettings: vi.fn(),
    changeSettings: vi.fn(),
    listLinks: vi.fn(),
    createLink: vi.fn(),
    revokeLink: vi.fn(),
    readPublicLink: vi.fn(),
    readAvailableLink,
  }
  app.get("/__replica/share/authorize", get(preview, sharing))
  try {
    await operation({
      origin: `http://127.0.0.1:${port}`,
      key,
      buildId,
      shareLinkId,
      readAvailableLink,
    })
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe("get()", () => {
  it("uses a separate share-and-Build-bound cookie without requiring a Hub session", async () => {
    await withRoute(async ({ origin, key, buildId, shareLinkId, readAvailableLink }) => {
      const grant = createSharePreviewGrant(
        {
          buildId,
          shareLinkId,
          expiresAt: new Date(Date.now() + 30_000),
        },
        key,
      )

      const response = await request(
        origin,
        `/__replica/share/authorize?grant=${encodeURIComponent(grant)}`,
        `${buildId}.preview.localhost:${new URL(origin).port}`,
      )

      expect(response.status).toBe(303)
      expect(response.headers.location).toBe("/checkout?step=shipping#address")
      expect(response.headers["set-cookie"]?.[0]).toMatch(
        /^replica_share_preview=.+; Path=\/; HttpOnly; SameSite=Lax; Expires=/,
      )
      expect(response.headers["set-cookie"]?.[0]).not.toContain("replica_preview=")
      expect(response.headers["set-cookie"]?.[0]).not.toContain("hub_session=")
      expect(response.headers["cache-control"]).toBe("private, no-store")
      expect(readAvailableLink).toHaveBeenCalledWith(shareLinkId, buildId)
    })
  })

  it("rechecks current link availability before issuing a public preview session", async () => {
    await withRoute(async ({ origin, key, buildId, shareLinkId, readAvailableLink }) => {
      readAvailableLink.mockResolvedValue(null)
      const grant = createSharePreviewGrant(
        {
          buildId,
          shareLinkId,
          expiresAt: new Date(Date.now() + 30_000),
        },
        key,
      )

      const response = await request(
        origin,
        `/__replica/share/authorize?grant=${encodeURIComponent(grant)}`,
        `${buildId}.preview.localhost:${new URL(origin).port}`,
        "hub_session=unrelated; replica_preview=private-preview",
      )

      expect(response.status).toBe(404)
      expect(response.headers["set-cookie"]).toBeUndefined()
      expect(readAvailableLink).toHaveBeenCalledWith(shareLinkId, buildId)
    })
  })

  it("does not redeem a grant on another Build origin", async () => {
    await withRoute(async ({ origin, key, buildId, shareLinkId, readAvailableLink }) => {
      const grant = createSharePreviewGrant(
        {
          buildId,
          shareLinkId,
          expiresAt: new Date(Date.now() + 30_000),
        },
        key,
      )

      const response = await request(
        origin,
        `/__replica/share/authorize?grant=${encodeURIComponent(grant)}`,
        `${randomUUID()}.preview.localhost:${new URL(origin).port}`,
      )

      expect(response.status).toBe(404)
      expect(response.headers["set-cookie"]).toBeUndefined()
      expect(readAvailableLink).not.toHaveBeenCalled()
    })
  })
})
