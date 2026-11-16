import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi, type Mock } from "vitest"

import type { ProductRouteDependencies } from "../../../../product/types"
import { get } from "."

/** Exercises response preparation without replacing it with a prebuilt JSON body. */
async function withDetailRoute(
  operation: (
    url: string,
    readIntroduction: Mock<ProductRouteDependencies["readPrototypeWithIntroduction"]>,
  ) => Promise<void>,
) {
  const repositoryId = randomUUID()
  const prototypeId = randomUUID()
  const detail = {
    repository: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    prototype: {
      id: prototypeId,
      repositoryId,
      name: "Checkout",
      branchName: "prototype/checkout",
      description: null,
      startPage: "/",
      authorLogin: null,
      authorName: null,
      authorProvider: null,
      canEdit: false,
      latestBuild: null,
      builds: [],
    },
    selectedBuild: null,
  }
  const readIntroduction = vi.fn<ProductRouteDependencies["readPrototypeWithIntroduction"]>(
    (_input, prepare) => Promise.resolve(prepare(detail, true)),
  )
  const product: ProductRouteDependencies = {
    listRepositories: vi.fn(),
    findRepositoryIndex: vi.fn(),
    findRepositoryAuthors: vi.fn(),
    editPrototypeMetadata: vi.fn(),
    findPrototypeDetail: vi.fn().mockResolvedValue(detail),
    readPrototypeWithIntroduction: readIntroduction,
  }
  const app = express()
  app.get(
    "/repositories/:repositoryId/prototypes/:prototypeId",
    get(
      {
        restore: vi.fn().mockResolvedValue({
          membershipId: randomUUID(),
          userId: randomUUID(),
          provider: "github",
          login: "viewer",
          name: null,
          role: "MEMBER",
        }),
      },
      product,
    ),
  )
  const server = createServer(app)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(
      `http://127.0.0.1:${port}/repositories/${repositoryId}/prototypes/${prototypeId}`,
      readIntroduction,
    )
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe("get()", () => {
  it("keeps editing available when preparing the first introduction response", async () => {
    await withDetailRoute(async (url) => {
      const response = await fetch(url, {
        headers: { cookie: "hub_session=member-session", "if-none-match": "*" },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        prototype: { canEdit: true },
        showPrototypeInfo: true,
      })
    })
  })

  it("keeps editing available without recording a minimized introduction", async () => {
    await withDetailRoute(async (url, readIntroduction) => {
      const response = await fetch(`${url}?view=minimized`, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        prototype: { canEdit: true },
        showPrototypeInfo: false,
      })
      expect(readIntroduction).not.toHaveBeenCalled()
    })
  })

  it("returns no body and records no introduction for a HEAD request", async () => {
    await withDetailRoute(async (url, readIntroduction) => {
      const response = await fetch(url, {
        method: "HEAD",
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe("")
      expect(readIntroduction).not.toHaveBeenCalled()
    })
  })
})
