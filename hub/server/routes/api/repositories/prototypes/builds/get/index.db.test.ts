import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../../../../create-app"
import { prisma } from "../../../../../../integrations/prisma"
import { createProductRouteDependencies } from "../../../../product/create-product-route-dependencies"
import type { AuthenticationRouteDependencies } from "../../../../auth/types"

interface BuildHistoryBody {
  repository: { id: string }
  prototype: {
    id: string
    repositoryId: string
    name: string
    canEdit: boolean
    startPage: string
    builds: { number: number }[]
  }
  builds: {
    number: number
    repositoryId: string
    prototypeId: string
    state: string
    previewUrl: string | null
    desktopScreenshotUrl: string | null
    narrowScreenshotUrl: string | null
  }[]
  pagination: { page: number; pageSize: number; totalCount: number; pageCount: number }
}

async function withServer(
  restore: AuthenticationRouteDependencies["currentSession"]["restore"],
  operation: (baseUrl: string) => Promise<void>,
) {
  const authentication: AuthenticationRouteDependencies = {
    currentSession: { restore },
    signOut: { applicationOrigin: "http://127.0.0.1:5173", secureCookie: false, end: vi.fn() },
  }
  const server = createServer(
    createApp({ authentication, product: createProductRouteDependencies() }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe("prototype Build history API", () => {
  it("pages through every Build of the prototype newest first with accurate totals", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    const otherPrototypeId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.prototype.createMany({
      data: [
        {
          id: prototypeId,
          repositoryId,
          branchName: "prototype/checkout",
          name: "Checkout",
          startPage: "/checkout",
          registeredAt: new Date("2026-10-01T00:00:00Z"),
        },
        {
          id: otherPrototypeId,
          repositoryId,
          branchName: "prototype/other",
          name: "Other",
          registeredAt: new Date("2026-10-01T00:00:00Z"),
        },
      ],
    })
    const states = ["successful", "failed", "running", "queued", "superseded"] as const
    const buildCount = 30
    // Number order and chronology agree, so the expected order needs no ordering decision.
    await prisma.build.createMany({
      data: Array.from({ length: buildCount }, (_, index) => {
        const createdAt = new Date(Date.UTC(2026, 9, 2, index))
        return {
          prototypeId,
          number: index + 1,
          state: states[index % states.length],
          workflowCreatedAt: createdAt,
          createdAt,
        }
      }),
    })
    await prisma.build.create({
      data: {
        prototypeId: otherPrototypeId,
        number: 99,
        state: "successful",
        createdAt: new Date("2026-11-01T00:00:00Z"),
      },
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })

    await withServer(restore, async (baseUrl) => {
      const historyUrl = `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds`
      const headers = { cookie: "hub_session=member-session" }
      const firstResponse = await fetch(historyUrl, { headers })
      expect(firstResponse.status).toBe(200)
      const first = (await firstResponse.json()) as BuildHistoryBody
      const { pageSize } = first.pagination
      const pageCount = Math.ceil(buildCount / pageSize)
      expect(pageCount).toBeGreaterThan(1)
      expect(first.pagination).toEqual({ page: 1, pageSize, totalCount: buildCount, pageCount })
      expect(first.builds).toHaveLength(pageSize)
      expect(first.repository.id).toBe(repositoryId)
      expect(first.prototype).toMatchObject({
        id: prototypeId,
        repositoryId,
        name: "Checkout",
        startPage: "/checkout",
        canEdit: true,
      })
      expect(await prisma.prototypeIntroduction.count()).toBe(0)

      const builds = [...first.builds]
      for (let page = 2; page <= pageCount; page += 1) {
        const response = await fetch(`${historyUrl}?page=${page}`, { headers })
        expect(response.status).toBe(200)
        const next = (await response.json()) as BuildHistoryBody
        expect(next.pagination).toEqual({ page, pageSize, totalCount: buildCount, pageCount })
        expect(next.builds).toHaveLength(Math.min(pageSize, buildCount - (page - 1) * pageSize))
        // The History view finds a pinned Build in the prototype record on any page.
        expect(next.prototype.builds.map(({ number }) => number).sort((a, b) => a - b)).toEqual(
          Array.from({ length: buildCount }, (_, index) => index + 1),
        )
        builds.push(...next.builds)
      }

      expect(builds.map(({ number }) => number)).toEqual(
        Array.from({ length: buildCount }, (_, index) => buildCount - index),
      )
      for (const build of builds) {
        expect(build).toMatchObject({
          repositoryId,
          prototypeId,
          state: states[(build.number - 1) % states.length],
          previewUrl: null,
          desktopScreenshotUrl: null,
          narrowScreenshotUrl: null,
        })
      }
    })
  })

  it("returns one empty page for a prototype without Builds", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: {
        id: prototypeId,
        repositoryId,
        branchName: "prototype/no-build",
        name: "No Build",
        registeredAt: new Date("2026-10-01T00:00:00Z"),
      },
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "entra",
      login: "member",
      name: "Member",
      role: "MEMBER",
    })

    await withServer(restore, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds`,
        { headers: { cookie: "hub_session=member-session" } },
      )
      expect(response.status).toBe(200)
      const history = (await response.json()) as BuildHistoryBody
      expect(history.builds).toEqual([])
      expect(history.pagination).toMatchObject({ page: 1, totalCount: 0, pageCount: 1 })
    })
  })

  it("rejects malformed pages and returns 404 for unavailable prototypes", async () => {
    const repositoryId = randomUUID()
    const otherRepositoryId = randomUUID()
    const removedRepositoryId = randomUUID()
    const prototypeId = randomUUID()
    const removedPrototypeId = randomUUID()
    await prisma.repository.createMany({
      data: [
        { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
        { id: otherRepositoryId, nameWithOwner: "team/other", defaultBranch: "main" },
        {
          id: removedRepositoryId,
          nameWithOwner: "team/removed",
          defaultBranch: "main",
          removedAt: new Date("2026-10-05T00:00:00Z"),
        },
      ],
    })
    await prisma.prototype.createMany({
      data: [
        {
          id: prototypeId,
          repositoryId,
          branchName: "prototype/checkout",
          name: "Checkout",
          registeredAt: new Date("2026-10-01T00:00:00Z"),
        },
        {
          id: removedPrototypeId,
          repositoryId: removedRepositoryId,
          branchName: "prototype/removed",
          name: "Removed",
          registeredAt: new Date("2026-10-01T00:00:00Z"),
        },
      ],
    })
    await prisma.build.create({
      data: { prototypeId, number: 1, state: "successful", createdAt: new Date("2026-10-02") },
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })

    await withServer(restore, async (baseUrl) => {
      const headers = { cookie: "hub_session=member-session" }
      for (const page of ["0", "abc", "1.5"]) {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds?page=${page}`,
          { headers },
        )
        expect(response.status, `page=${page}`).toBe(400)
      }
      const unavailable = [
        [repositoryId, randomUUID()],
        [otherRepositoryId, prototypeId],
        [removedRepositoryId, removedPrototypeId],
      ]
      for (const [repository, prototype] of unavailable) {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repository}/prototypes/${prototype}/builds`,
          { headers },
        )
        expect(response.status, `${repository}/${prototype}`).toBe(404)
        expect(await response.text()).not.toContain("prototype/")
      }
    })
  })

  it("requires a current session and revalidates membership before returning Builds", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/private", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: {
        id: prototypeId,
        repositoryId,
        branchName: "prototype/private",
        name: "Private prototype",
        registeredAt: new Date("2026-10-01T00:00:00Z"),
      },
    })
    await prisma.build.create({
      data: { prototypeId, number: 1, state: "successful", createdAt: new Date("2026-10-02") },
    })
    const historyPath = `/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds`
    const member = {
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER" as const,
    }

    await withServer(vi.fn().mockResolvedValue(null), async (baseUrl) => {
      const response = await fetch(`${baseUrl}${historyPath}`, {
        headers: { cookie: "hub_session=expired-session" },
      })
      expect(response.status).toBe(401)
      expect(await response.text()).not.toContain("Private prototype")
    })

    const restore = vi
      .fn()
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce({ ...member, membershipId: randomUUID() })
    await withServer(restore, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${historyPath}`, {
        headers: { cookie: "hub_session=member-session" },
      })
      expect(response.status).toBe(401)
      expect(await response.text()).not.toContain("Private prototype")
      expect(restore).toHaveBeenCalledTimes(2)
    })
  })
})
