import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi, type Mock } from "vitest"

import type { CurrentSessionDependencies } from "../../../../../auth/types"
import { hashAuthenticationValue } from "../../../../../../../domains/authentication/hash-authentication-value"
import { secureHubSessionCookieSetting } from "../../../../../../../integrations/express/hub-session-cookie-name"
import type { ProductRouteDependencies } from "../../../../../product/types"
import { get } from "."

type ProductMocks = Omit<ProductRouteDependencies, "findBuildPreviewTarget"> & {
  findBuildPreviewTarget: Mock<ProductRouteDependencies["findBuildPreviewTarget"]>
}
type ReadBuildArtifact = Mock<NonNullable<ProductRouteDependencies["readBuildArtifact"]>>

async function withScreenshotRoute(
  path: string,
  operation: (
    url: string,
    product: ProductMocks,
    readBuildArtifact: ReadBuildArtifact,
    restore: Mock<CurrentSessionDependencies["restore"]>,
  ) => Promise<void>,
  { secureCookie = false } = {},
) {
  const viewer = {
    membershipId: randomUUID(),
    userId: randomUUID(),
    provider: "github",
    login: "mona",
    name: "Mona",
    role: "MEMBER" as const,
  }
  const product: ProductMocks = {
    isRepositoryVisible: vi.fn().mockResolvedValue(true),
    listRepositories: vi.fn(),
    findRepositoryIndex: vi.fn(),
    findRepositoryAuthors: vi.fn(),
    editPrototypeMetadata: vi.fn(),
    readPrototypeWithIntroduction: vi.fn(),
    findPrototypeDetail: vi.fn(),
    findBuildPreviewTarget: vi.fn().mockResolvedValue({
      buildId: randomUUID(),
      startPage: "/",
      artifactPath: "screenshots/desktop.png",
    }),
  }
  const readBuildArtifact: ReadBuildArtifact = vi.fn()
  const restore: Mock<CurrentSessionDependencies["restore"]> = vi.fn().mockResolvedValue(viewer)
  const app = express()
  app.set(secureHubSessionCookieSetting, secureCookie)
  app.get(
    "/:repositoryId/:prototypeId/:buildNumber/screenshots/:size",
    get({ restore }, product, readBuildArtifact),
  )
  const server = createServer(app)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}${path}`, product, readBuildArtifact, restore)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

const member = { headers: { cookie: "hub_session=member-session" } }

describe("get()", () => {
  it("requires an authenticated Hub session before resolving a Build", async () => {
    const path = `/${randomUUID()}/${randomUUID()}/42/screenshots/desktop`
    await withScreenshotRoute(path, async (url, product, readBuildArtifact) => {
      const response = await fetch(url)

      expect(response.status).toBe(401)
      expect(product.findBuildPreviewTarget).not.toHaveBeenCalled()
      expect(readBuildArtifact).not.toHaveBeenCalled()
    })
  })

  it("serves the stored screenshot to members as an isolated private PNG", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    const buildId = randomUUID()
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const path = `/${repositoryId}/${prototypeId}/42/screenshots/desktop`
    await withScreenshotRoute(path, async (url, product, readBuildArtifact) => {
      product.findBuildPreviewTarget.mockResolvedValue({
        buildId,
        startPage: "/",
        artifactPath: "screenshots/desktop.png",
      })
      readBuildArtifact.mockResolvedValue({ status: "ok", bytes })

      const response = await fetch(url, member)

      expect(response.status).toBe(200)
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
      expect(response.headers.get("content-type")).toMatch(/^image\/png\b/)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin")
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox")
      expect(product.findBuildPreviewTarget).toHaveBeenCalledWith(
        repositoryId,
        prototypeId,
        42,
        "desktop",
      )
      expect(readBuildArtifact).toHaveBeenCalledWith(
        buildId,
        "screenshots/desktop.png",
        expect.any(Function),
      )
    })
  })

  it("does not read storage when the repository is no longer visible", async () => {
    const path = `/${randomUUID()}/${randomUUID()}/42/screenshots/narrow`
    await withScreenshotRoute(path, async (url, product, readBuildArtifact) => {
      vi.mocked(product.isRepositoryVisible).mockResolvedValueOnce(true).mockResolvedValue(false)

      const response = await fetch(url, member)

      expect(response.status).toBe(404)
      expect(readBuildArtifact).not.toHaveBeenCalled()
    })
  })

  it("reports temporarily unavailable storage separately from a missing screenshot", async () => {
    const path = `/${randomUUID()}/${randomUUID()}/42/screenshots/desktop`
    await withScreenshotRoute(path, async (url, _product, readBuildArtifact) => {
      readBuildArtifact.mockResolvedValue({ status: "unavailable" })

      const response = await fetch(url, member)

      expect(response.status).toBe(503)
      expect(response.headers.get("content-type")).not.toMatch(/^image\//)
    })
  })

  it("reads the protected Hub session cookie when HTTPS sessions are enabled", async () => {
    const path = `/${randomUUID()}/${randomUUID()}/42/screenshots/desktop`
    await withScreenshotRoute(
      path,
      async (url, _product, readBuildArtifact, restore) => {
        readBuildArtifact.mockResolvedValue({ status: "ok", bytes: new Uint8Array([0x89]) })

        const response = await fetch(url, {
          headers: { cookie: "__Host-hub_session=protected-session" },
        })

        expect(response.status).toBe(200)
        expect(restore).toHaveBeenCalledWith(hashAuthenticationValue("protected-session"))
      },
      { secureCookie: true },
    )
  })

  it("rejects sizes other than desktop and narrow", async () => {
    const path = `/${randomUUID()}/${randomUUID()}/42/screenshots/preview`
    await withScreenshotRoute(path, async (url, product, readBuildArtifact) => {
      const response = await fetch(url, member)

      expect(response.status).toBe(400)
      expect(product.findBuildPreviewTarget).not.toHaveBeenCalled()
      expect(readBuildArtifact).not.toHaveBeenCalled()
    })
  })
})
