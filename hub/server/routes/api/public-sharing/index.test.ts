import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi, type Mock } from "vitest"

import type { CurrentSessionDependencies } from "../auth/types"
import type { ProductRouteDependencies } from "../product/types"
import { del as deleteLink } from "./links/delete"
import { get as getLinks } from "./links/get"
import { post as createLink } from "./links/post"
import { get as getPublicLink } from "./public/get"
import { get as getSettings } from "./settings/get"
import { patch as changeSettings } from "./settings/patch"
import type { PublicSharingRouteDependencies } from "./types"

type SharingMocks = {
  [Key in keyof PublicSharingRouteDependencies]: PublicSharingRouteDependencies[Key] extends (
    ...args: infer Args
  ) => infer Result
    ? Mock<(...args: Args) => Result>
    : PublicSharingRouteDependencies[Key]
}

const member = {
  membershipId: randomUUID(),
  userId: randomUUID(),
  provider: "local",
  login: "local-developer",
  name: "Local developer",
  role: "MEMBER" as const,
}

function sharingDependencies(): SharingMocks {
  return {
    applicationOrigin: "https://hub.example.com",
    previewBaseOrigin: "https://preview.example.com",
    maximumDays: 7,
    getSettings: vi.fn().mockResolvedValue({
      enabled: false,
      revision: 0,
      activeLinkCount: 0,
    }),
    changeSettings: vi.fn().mockResolvedValue({ enabled: true, revision: 1 }),
    listLinks: vi.fn().mockResolvedValue([]),
    createLink: vi.fn(),
    revokeLink: vi.fn(),
    readPublicLink: vi.fn(),
    readAvailableLink: vi.fn(),
  }
}

function productDependencies(): ProductRouteDependencies {
  return {
    isRepositoryVisible: vi.fn().mockResolvedValue(true),
    listRepositories: vi.fn(),
    findRepositoryIndex: vi.fn(),
    findRepositoryAuthors: vi.fn(),
    editPrototypeMetadata: vi.fn(),
    readPrototypeWithIntroduction: vi.fn(),
    findPrototypeDetail: vi.fn(),
    findBuildPreviewTarget: vi.fn(),
  }
}

async function withRoutes(
  input: {
    restore?: CurrentSessionDependencies["restore"]
    sharing?: SharingMocks
    product?: ProductRouteDependencies
  },
  operation: (
    baseUrl: string,
    sharing: SharingMocks,
    product: ProductRouteDependencies,
  ) => Promise<void>,
) {
  const sharing = input.sharing ?? sharingDependencies()
  const product = input.product ?? productDependencies()
  const session = { restore: input.restore ?? vi.fn().mockResolvedValue(member) }
  const app = express()
  app.use(express.json())
  app.get("/api/product/sharing-settings", getSettings(session, sharing))
  app.patch("/api/product/sharing-settings", changeSettings(session, sharing))
  app.get(
    "/api/repositories/:repositoryId/prototypes/:prototypeId/share-links",
    getLinks(session, product, sharing),
  )
  app.post(
    "/api/repositories/:repositoryId/prototypes/:prototypeId/share-links",
    createLink(session, sharing),
  )
  app.delete(
    "/api/repositories/:repositoryId/prototypes/:prototypeId/share-links/:shareId",
    deleteLink(session, sharing),
  )
  app.get("/api/shared/:shareId", getPublicLink(sharing))
  const server = createServer(app)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`, sharing, product)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

function sessionHeaders(headers: Record<string, string> = {}) {
  return { cookie: "hub_session=local-session", ...headers }
}

describe("public sharing API", () => {
  it("lets a signed-in member read settings but reserves confirmed changes for a live administrator", async () => {
    const administrator = { ...member, role: "ADMINISTRATOR" as const }
    const restore = vi
      .fn()
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce(administrator)
      .mockResolvedValueOnce(administrator)

    await withRoutes({ restore }, async (baseUrl, sharing) => {
      const settings = await fetch(`${baseUrl}/api/product/sharing-settings`, {
        headers: sessionHeaders(),
      })
      expect(settings.status).toBe(200)
      expect(await settings.json()).toEqual({
        enabled: false,
        canAdminister: false,
        activeLinkCount: 0,
      })

      const denied = await fetch(`${baseUrl}/api/product/sharing-settings`, {
        method: "PATCH",
        headers: sessionHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ operation: "enable", confirmed: true }),
      })
      expect(denied.status).toBe(403)
      expect(sharing.changeSettings).not.toHaveBeenCalled()

      const allowed = await fetch(`${baseUrl}/api/product/sharing-settings`, {
        method: "PATCH",
        headers: sessionHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ operation: "enable", confirmed: true }),
      })
      expect(allowed.status).toBe(200)
      expect(sharing.changeSettings).toHaveBeenCalledWith("enable")
    })
  })

  it("rejects unsupported expirations before creating a link", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()

    await withRoutes({}, async (baseUrl, sharing) => {
      const response = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}/share-links`,
        {
          method: "POST",
          headers: sessionHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            buildNumber: 1,
            expiration: "thirty_days",
            label: "Partner review",
          }),
        },
      )

      expect(response.status).toBe(422)
      expect(sharing.createLink).not.toHaveBeenCalled()
    })
  })

  it("does not create a link when the signed-in identity changes during the request", async () => {
    const restore = vi
      .fn()
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce({ ...member, userId: randomUUID() })

    await withRoutes({ restore }, async (baseUrl, sharing) => {
      const response = await fetch(
        `${baseUrl}/api/repositories/${randomUUID()}/prototypes/${randomUUID()}/share-links`,
        {
          method: "POST",
          headers: sessionHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            buildNumber: 1,
            expiration: "seven_days",
            label: "Partner review",
          }),
        },
      )

      expect(response.status).toBe(401)
      expect(sharing.createLink).not.toHaveBeenCalled()
    })
  })

  it("returns an explicit 404 when a requested revoke cannot find an active link", async () => {
    const sharing = sharingDependencies()
    sharing.revokeLink.mockResolvedValue(false)

    await withRoutes({ sharing }, async (baseUrl) => {
      const repositoryId = randomUUID()
      const prototypeId = randomUUID()
      const publicId = randomUUID()
      const response = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}/share-links/${publicId}`,
        { method: "DELETE", headers: sessionHeaders() },
      )

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: "Active share link not found." })
      expect(sharing.revokeLink).toHaveBeenCalledWith({
        repositoryId,
        prototypeId,
        publicId,
        actorMembershipId: member.membershipId,
      })
    })
  })

  it("serves active public presentation without a Hub cookie or private repository metadata", async () => {
    const sharing = sharingDependencies()
    const shareId = randomUUID()
    const buildId = randomUUID()
    sharing.readPublicLink.mockResolvedValue({
      state: "active",
      id: randomUUID(),
      buildId,
      buildNumber: 7,
      expiresAt: new Date("2026-11-20T12:00:00Z"),
      label: "Partner review",
      prototypeName: "Welcome",
      startPage: "/checkout",
    })

    await withRoutes({ sharing }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/shared/${shareId}`)
      const body = (await response.json()) as Record<string, unknown>

      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(body).toEqual({
        state: "active",
        label: "Partner review",
        prototypeName: "Welcome",
        buildNumber: 7,
        previewUrl: `https://hub.example.com/api/shared/${shareId}/preview`,
        expiresAt: "2026-11-20T12:00:00.000Z",
        controlsIdentity: `share:${shareId}`,
        controlsOrigin: `https://${buildId}.preview.example.com`,
      })
      expect(body).not.toHaveProperty("repositoryId")
      expect(body).not.toHaveProperty("prototypeId")
      expect(body).not.toHaveProperty("branchName")
      expect(body).not.toHaveProperty("reviewComments")
    })
  })

  it.each(["expired", "revoked", "disabled"] as const)(
    "returns only the safe %s state for a known opaque token",
    async (state) => {
      const sharing = sharingDependencies()
      sharing.readPublicLink.mockResolvedValue({ state })

      await withRoutes({ sharing }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/shared/${randomUUID()}`)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ state, label: "Shared preview" })
      })
    },
  )

  it("hides an unavailable saved Build behind the same 404 as an unknown token", async () => {
    const sharing = sharingDependencies()
    sharing.readPublicLink.mockResolvedValue({ state: "unavailable" })

    await withRoutes({ sharing }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/shared/${randomUUID()}`)

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: "Shared preview not found." })
    })
  })

  it("returns 404 for an unknown public token without exposing whether private records exist", async () => {
    await withRoutes({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/shared/${randomUUID()}`)

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: "Shared preview not found." })
    })
  })
})
