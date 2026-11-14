import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi, type Mock } from "vitest"

import type { CurrentSessionDependencies } from "../../../../auth/types"
import type { ProductRouteDependencies } from "../../../../product/types"
import { get } from "."

type ProductMocks = {
  [Key in keyof ProductRouteDependencies]: Mock<ProductRouteDependencies[Key]>
}

/** Keeps the real HTTP parsing and response while isolating database access. */
async function withHistory(
  operation: (url: string, product: ProductMocks) => Promise<void>,
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
    findPrototypeDetail: vi.fn().mockResolvedValue({
      repository: { id: repositoryId },
      prototype: {
        id: prototypeId,
        startPage: "/checkout",
        canEdit: false,
        builds: Array.from({ length: 26 }, (_, index) => ({
          number: index + 1,
          state: index % 2 ? "failed" : "successful",
        })),
      },
    }),
  }
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
    await operation(`http://127.0.0.1:${port}/${repositoryId}/${prototypeId}`, product)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe("get()", () => {
  it("returns older Builds without consuming an introduction or changing metadata", async () => {
    await withHistory(async (url, product) => {
      const response = await fetch(`${url}?page=2`, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        prototype: { canEdit: true, startPage: "/checkout", builds: { length: 26 } },
        builds: [{ number: 1 }],
        pagination: { page: 2, pageSize: 25, totalCount: 26, pageCount: 2 },
      })
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
})
