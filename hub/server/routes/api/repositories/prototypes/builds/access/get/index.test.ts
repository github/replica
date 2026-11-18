import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi, type Mock } from "vitest"

import { hashAuthenticationValue } from "../../../../../../../domains/authentication/hash-authentication-value"
import { readPreviewGrant } from "../../../../../../../domains/build-preview/read-preview-grant"
import type { CurrentSessionDependencies } from "../../../../../auth/types"
import type { ProductRouteDependencies } from "../../../../../product/types"
import type { BuildPreviewRouteDependencies } from "../../../../../../build-preview/types"
import { get } from "."

type ProductMocks = Omit<ProductRouteDependencies, "findBuildPreviewTarget"> & {
  findBuildPreviewTarget: Mock<NonNullable<ProductRouteDependencies["findBuildPreviewTarget"]>>
}

async function withAccessRoute(
  operation: (
    url: string,
    product: ProductMocks,
    preview: BuildPreviewRouteDependencies,
  ) => Promise<void>,
  restore?: CurrentSessionDependencies["restore"],
) {
  const repositoryId = randomUUID()
  const prototypeId = randomUUID()
  const viewer = {
    membershipId: randomUUID(),
    userId: randomUUID(),
    provider: "github",
    login: "mona",
    name: "Mona",
    role: "MEMBER" as const,
  }
  const product: ProductMocks = {
    listRepositories: vi.fn(),
    findRepositoryIndex: vi.fn(),
    findRepositoryAuthors: vi.fn(),
    editPrototypeMetadata: vi.fn(),
    readPrototypeWithIntroduction: vi.fn(),
    findPrototypeDetail: vi.fn(),
    findBuildPreviewTarget: vi.fn().mockResolvedValue({
      buildId: randomUUID(),
      startPage: "/checkout",
      artifactPath: "dist/index.html",
    }),
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
  }
  const app = express()
  app.get(
    "/:repositoryId/:prototypeId/:buildNumber/access",
    get({ restore: restore ?? vi.fn().mockResolvedValue(viewer) }, product, preview),
  )
  const server = createServer(app)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(
      `http://127.0.0.1:${port}/${repositoryId}/${prototypeId}/42/access`,
      product,
      preview,
    )
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe("get()", () => {
  it("requires an authenticated Hub session before resolving a Build", async () => {
    await withAccessRoute(async (url, product) => {
      const response = await fetch(`${url}?target=preview`, { redirect: "manual" })

      expect(response.status).toBe(401)
      expect(product.findBuildPreviewTarget).not.toHaveBeenCalled()
    })
  })

  it("redirects authorized members to a short-lived Build-origin grant", async () => {
    await withAccessRoute(async (url, product, preview) => {
      const request = new URL(url)
      request.searchParams.set("target", "preview")
      request.searchParams.set("route", "/checkout?step=shipping#address")
      const response = await fetch(request, {
        headers: { cookie: "hub_session=member-session" },
        redirect: "manual",
      })

      expect(response.status).toBe(302)
      const destination = new URL(response.headers.get("location")!)
      expect(destination.origin).toMatch(/^https:\/\/[\da-f-]+\.preview\.example\.com$/)
      expect(destination.pathname).toBe("/__replica/authorize")
      const grant = readPreviewGrant(destination.searchParams.get("grant")!, preview.encryptionKey)
      expect(grant).toMatchObject({
        target: "preview",
        sessionDigest: hashAuthenticationValue("member-session"),
      })
      expect(destination.searchParams.get("route")).toBe("/checkout?step=shipping#address")
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(response.headers.get("referrer-policy")).toBe("no-referrer")
      const [repositoryId, prototypeId] = new URL(url).pathname.slice(1).split("/")
      expect(product.findBuildPreviewTarget).toHaveBeenCalledWith(
        repositoryId,
        prototypeId,
        42,
        "preview",
      )
    })
  })

  it("discards the target when session authority changes during the read", async () => {
    const viewer = {
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER" as const,
    }
    const restore = vi
      .fn()
      .mockResolvedValueOnce(viewer)
      .mockResolvedValueOnce({ ...viewer, membershipId: randomUUID() })

    await withAccessRoute(async (url, product) => {
      const response = await fetch(`${url}?target=desktop`, {
        headers: { cookie: "hub_session=member-session" },
        redirect: "manual",
      })

      expect(response.status).toBe(401)
      expect(response.headers.get("location")).toBeNull()
      expect(product.findBuildPreviewTarget).toHaveBeenCalledOnce()
    }, restore)
  })

  it("rejects a tampered Build origin hint", async () => {
    await withAccessRoute(async (url) => {
      const request = new URL(url)
      request.searchParams.set("target", "preview")
      request.searchParams.set("preview_origin", "https://untrusted.example.com")
      const response = await fetch(request, {
        headers: { cookie: "hub_session=member-session" },
        redirect: "manual",
      })

      expect(response.status).toBe(400)
      expect(response.headers.get("location")).toBeNull()
    })
  })

  it("rejects an unsafe deep-link route", async () => {
    await withAccessRoute(async (url) => {
      const request = new URL(url)
      request.searchParams.set("target", "preview")
      request.searchParams.set("route", "https://untrusted.example.com")
      const response = await fetch(request, {
        headers: { cookie: "hub_session=member-session" },
        redirect: "manual",
      })

      expect(response.status).toBe(400)
      expect(response.headers.get("location")).toBeNull()
    })
  })

  it("carries long valid routes outside the bounded encrypted grant", async () => {
    await withAccessRoute(async (url, _product, preview) => {
      const route = `/${"a".repeat(1500)}`
      const request = new URL(url)
      request.searchParams.set("target", "preview")
      request.searchParams.set("route", route)
      const response = await fetch(request, {
        headers: { cookie: "hub_session=member-session" },
        redirect: "manual",
      })

      expect(response.status).toBe(302)
      const destination = new URL(response.headers.get("location")!)
      expect(destination.searchParams.get("route")).toBe(route)
      expect(
        readPreviewGrant(destination.searchParams.get("grant")!, preview.encryptionKey),
      ).toMatchObject({ target: "preview" })
    })
  })
})
