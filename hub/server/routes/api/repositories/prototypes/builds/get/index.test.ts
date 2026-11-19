import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi, type Mock } from "vitest"

import type { CurrentSessionDependencies } from "../../../../auth/types"
import type { ProductRouteDependencies, ProductViewer } from "../../../../product/types"
import { get } from "."

type ProductMocks = {
  [
    Key in Exclude<
      keyof ProductRouteDependencies,
      | "authorizeReviewAccess"
      | "reviewComments"
      | "findLocalPrototypeManagement"
      | "findPrototypeManagement"
      | "analytics"
      | "getRepositoryPermission"
      | "getVerifiedRepositoryPermission"
      | "isPrototypeReviewable"
      | "searchReviewMentions"
      | "reviewInbox"
    >
  ]: Mock<ProductRouteDependencies[Key]>
}

function productWithHistory(repositoryId: string, prototypeId: string): ProductMocks {
  return {
    isRepositoryVisible: vi.fn(),
    listRepositories: vi.fn(),
    findRepositoryIndex: vi.fn(),
    findRepositoryAuthors: vi.fn(),
    editPrototypeMetadata: vi.fn(),
    readPrototypeWithIntroduction: vi.fn(),
    findBuildPreviewTarget: vi.fn(),
    findPrototypeDetail: vi.fn().mockResolvedValue({
      repository: { id: repositoryId },
      prototype: {
        id: prototypeId,
        startPage: "/checkout",
        canEdit: false,
        builds: [
          { number: 26, state: "successful" },
          { number: 1, state: "failed" },
        ],
      },
      buildPage: { builds: [{ number: 1, state: "failed" }], totalCount: 26 },
    }),
  }
}

function githubAdministrator() {
  return {
    membershipId: randomUUID(),
    userId: randomUUID(),
    provider: "github",
    sessionProvider: "github",
    login: "mona",
    name: "Mona",
    role: "ADMINISTRATOR" as const,
  }
}

/** Keeps the real HTTP parsing and response while isolating database access. */
async function withHistory(
  operation: (url: string, product: ProductMocks, viewer: ProductViewer) => Promise<void>,
  restore?: CurrentSessionDependencies["restore"],
) {
  const repositoryId = randomUUID()
  const prototypeId = randomUUID()
  const viewer = {
    membershipId: randomUUID(),
    userId: randomUUID(),
    provider: "github",
    sessionProvider: "github",
    login: "mona",
    name: "Mona",
    role: "MEMBER" as const,
  }
  const product = productWithHistory(repositoryId, prototypeId)
  const app = express()
  app.get(
    "/:repositoryId/:prototypeId",
    get({ restore: restore ?? vi.fn().mockResolvedValue(viewer) }, product),
  )
  const server = createServer(app)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}/${repositoryId}/${prototypeId}`, product, viewer)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe("get()", () => {
  it("returns older Builds without consuming an introduction or changing metadata", async () => {
    await withHistory(async (url, product, viewer) => {
      const response = await fetch(`${url}?page=2&build=26`, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        prototype: { canEdit: true, startPage: "/checkout", builds: { length: 2 } },
        builds: [{ number: 1 }],
        pagination: { page: 2, pageSize: 25, totalCount: 26, pageCount: 2 },
      })
      const [repositoryId, prototypeId] = new URL(url).pathname.slice(1).split("/")
      expect(product.findPrototypeDetail).toHaveBeenCalledWith(
        viewer,
        repositoryId,
        prototypeId,
        26,
        { page: 2, pageSize: 25 },
      )
      expect(product.readPrototypeWithIntroduction).not.toHaveBeenCalled()
      expect(product.editPrototypeMetadata).not.toHaveBeenCalled()
    })
  })

  it("rejects malformed and repeated page values before reading Builds", async () => {
    await withHistory(async (url, product) => {
      for (const query of ["page=0", "page=1.5", "page=1000000000", "page=1&page=2"]) {
        const response = await fetch(`${url}?${query}`, {
          headers: { cookie: "hub_session=member-session" },
        })
        expect(response.status, query).toBe(400)
      }
      expect(product.findPrototypeDetail).not.toHaveBeenCalled()
    })
  })

  it("returns 404 instead of repeating the last history page", async () => {
    await withHistory(async (url) => {
      const response = await fetch(`${url}?page=3`, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(404)
    })
  })

  it("does not read Builds without a session cookie", async () => {
    await withHistory(async (url, product) => {
      expect((await fetch(url)).status).toBe(401)
      expect(product.findPrototypeDetail).not.toHaveBeenCalled()
    })
  })

  it("discards Builds when the user changes during the read", async () => {
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
      .fn()
      .mockResolvedValueOnce(viewer)
      .mockResolvedValueOnce({ ...viewer, userId: randomUUID() })
    await withHistory(async (url) => {
      const response = await fetch(url, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(401)
      expect(await response.json()).not.toHaveProperty("builds")
    }, restore)
  })

  it("rereads Builds with the current role after an administrator becomes a member", async () => {
    const administrator = githubAdministrator()
    const member = { ...administrator, role: "MEMBER" as const }
    const restore = vi.fn().mockResolvedValueOnce(administrator).mockResolvedValue(member)

    await withHistory(async (url, product) => {
      const read = product.findPrototypeDetail.getMockImplementation()
      if (!read) throw new Error("Build history fixture is missing.")
      product.findPrototypeDetail.mockImplementationOnce(async (...args) => {
        const detail = await read(...args)
        if (!detail?.buildPage) return detail
        return { ...detail, buildPage: { ...detail.buildPage, totalCount: 99 } }
      })

      const response = await fetch(url, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        builds: [{ number: 1 }],
        pagination: { totalCount: 26 },
      })
      expect(product.findPrototypeDetail.mock.calls.map(([viewer]) => viewer)).toEqual([
        administrator,
        member,
      ])
      expect(restore).toHaveBeenCalledTimes(3)
    }, restore)
  })

  it("discards Builds when the authenticated session provider changes", async () => {
    const administrator = githubAdministrator()
    const restore = vi
      .fn()
      .mockResolvedValueOnce(administrator)
      .mockResolvedValueOnce({ ...administrator, sessionProvider: "entra" })

    await withHistory(async (url, product) => {
      const response = await fetch(url, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(401)
      expect(await response.json()).not.toHaveProperty("builds")
      expect(product.findPrototypeDetail).toHaveBeenCalledOnce()
      expect(restore).toHaveBeenCalledTimes(2)
    }, restore)
  })

  it.each(["revoked", "changed role again"])(
    "discards Builds if the session is %s during the reread",
    async (change) => {
      const administrator = githubAdministrator()
      const member = { ...administrator, role: "MEMBER" as const }
      const restore = vi
        .fn()
        .mockResolvedValueOnce(administrator)
        .mockResolvedValueOnce(member)
        .mockResolvedValueOnce(change === "revoked" ? null : administrator)

      await withHistory(async (url, product) => {
        const response = await fetch(url, {
          headers: { cookie: "hub_session=member-session" },
        })
        expect(response.status).toBe(401)
        expect(await response.json()).not.toHaveProperty("builds")
        expect(product.findPrototypeDetail.mock.calls.map(([viewer]) => viewer)).toEqual([
          administrator,
          member,
        ])
        expect(restore).toHaveBeenCalledTimes(3)
      }, restore)
    },
  )
})
