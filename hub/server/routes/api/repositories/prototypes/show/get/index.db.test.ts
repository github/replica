import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../../../../create-app"
import { prisma } from "../../../../../../integrations/prisma"
import { createProductRouteDependencies } from "../../../../product/create-product-route-dependencies"
import type { AuthenticationRouteDependencies } from "../../../../auth/types"

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

async function createBuild(
  prototypeId: string,
  number: number,
  state: "failed" | "queued" | "running" | "successful" | "superseded",
  workflowCreatedAt: string | null,
  createdAt: string,
) {
  return prisma.build.create({
    data: {
      prototypeId,
      number,
      state,
      workflowCreatedAt: workflowCreatedAt ? new Date(workflowCreatedAt) : null,
      createdAt: new Date(createdAt),
    },
  })
}

describe("prototype detail API", () => {
  it("returns stored non-GitHub author profiles", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const authors = [
      { login: "sam@example.test", name: "Sam Rivera" },
      { login: "lee@example.test", name: null },
    ]
    const prototypeIds: string[] = []
    for (const [index, author] of authors.entries()) {
      const user = await prisma.user.create({
        data: {
          profile: {
            create: { provider: "entra", login: author.login, name: author.name },
          },
        },
      })
      const prototype = await prisma.prototype.create({
        data: {
          repositoryId,
          authorId: user.id,
          branchName: `prototype/author-${index}`,
          name: `Author ${index}`,
        },
      })
      prototypeIds.push(prototype.id)
    }
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      login: "viewer",
      name: "Viewer",
      role: "MEMBER",
    })

    await withServer(restore, async (baseUrl) => {
      for (const [index, author] of authors.entries()) {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeIds[index]}`,
          { headers: { cookie: "hub_session=member-session" } },
        )
        expect(response.status).toBe(200)
        const detail = (await response.json()) as { prototype: unknown }
        expect(detail.prototype).toMatchObject({
          authorProvider: "entra",
          authorName: author.name,
          authorLogin: author.login,
        })
      }
    })
  })

  it("selects the latest successful Build by Rails chronology", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: {
        id: prototypeId,
        repositoryId,
        branchName: "prototype/checkout",
        name: "Checkout",
        registeredAt: new Date("2026-10-01T00:00:00Z"),
      },
    })
    await createBuild(prototypeId, 2, "successful", "2026-10-08T00:00:00Z", "2026-10-20T00:00:00Z")
    await createBuild(prototypeId, 4, "successful", "2026-10-09T00:00:00Z", "2026-10-10T00:00:00Z")
    await createBuild(prototypeId, 5, "successful", "2026-10-09T00:00:00Z", "2026-10-01T00:00:00Z")
    await createBuild(prototypeId, 6, "successful", null, "2026-10-08T00:00:00Z")
    await createBuild(prototypeId, 20, "failed", "2026-10-10T00:00:00Z", "2026-10-10T00:00:00Z")
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
      const defaultResponse = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}`,
        { headers },
      )
      expect(defaultResponse.status).toBe(200)
      const defaultDetail = (await defaultResponse.json()) as {
        selectedBuild: { number: number } | null
      }
      expect(defaultDetail.selectedBuild).toMatchObject({ number: 5 })

      const selectedResponse = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}?build=2`,
        { headers },
      )
      expect(selectedResponse.status).toBe(200)
      const selectedDetail = (await selectedResponse.json()) as {
        selectedBuild: {
          number: number
          commitSha: string | null
          commitAuthorLogin: string | null
        } | null
      }
      expect(selectedDetail.selectedBuild).toMatchObject({
        number: 2,
        commitSha: null,
        commitAuthorLogin: null,
      })
    })
  })

  it("keeps detail visibility independent of registration and branch existence", async () => {
    const repositoryId = randomUUID()
    const unregisteredId = randomUUID()
    const deletedBranchId = randomUUID()
    const defaultBranchId = randomUUID()
    const internalId = randomUUID()
    const installWorkflowId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.prototype.createMany({
      data: [
        {
          id: unregisteredId,
          repositoryId,
          branchName: "prototype/unregistered",
        },
        {
          id: deletedBranchId,
          repositoryId,
          branchName: "prototype/deleted",
          name: "Deleted branch",
          registeredAt: new Date("2026-10-01T00:00:00Z"),
          branchDeletedAt: new Date("2026-10-02T00:00:00Z"),
        },
        {
          id: defaultBranchId,
          repositoryId,
          branchName: "main",
          name: "Default branch",
          registeredAt: new Date("2026-10-01T00:00:00Z"),
        },
        {
          id: internalId,
          repositoryId,
          branchName: "replica/internal",
          name: "Internal prototype",
          replica: true,
        },
        {
          id: installWorkflowId,
          repositoryId,
          branchName: "replica/install-workflow",
          name: "Install workflow",
          registeredAt: new Date("2026-10-01T00:00:00Z"),
        },
      ],
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
      const headers = { cookie: "hub_session=member-session" }
      const unregisteredResponse = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/prototypes/${unregisteredId}`,
        { headers },
      )
      expect(unregisteredResponse.status).toBe(200)
      const unregisteredDetail = (await unregisteredResponse.json()) as {
        prototype: { name: string; branchName: string }
      }
      expect(unregisteredDetail.prototype).toMatchObject({
        name: "prototype/unregistered",
        branchName: "prototype/unregistered",
      })

      const deletedResponse = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/prototypes/${deletedBranchId}`,
        { headers },
      )
      expect(deletedResponse.status).toBe(200)

      for (const hiddenId of [defaultBranchId, internalId, installWorkflowId]) {
        const hiddenResponse = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/prototypes/${hiddenId}`,
          { headers },
        )
        expect(hiddenResponse.status).toBe(404)
      }
    })
  })

  it("returns no selected Build when the prototype has no successful Build", async () => {
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
    await createBuild(prototypeId, 1, "failed", "2026-10-02T00:00:00Z", "2026-10-02T00:00:00Z")
    await createBuild(prototypeId, 2, "queued", null, "2026-10-03T00:00:00Z")
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })

    await withServer(restore, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}`,
        { headers: { cookie: "hub_session=member-session" } },
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ selectedBuild: null })
    })
  })

  it("returns 404 for invalid, unavailable, or unsuccessful Build selections", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: {
        id: prototypeId,
        repositoryId,
        branchName: "prototype/build-selection",
        name: "Build selection",
        registeredAt: new Date("2026-10-01T00:00:00Z"),
      },
    })
    await createBuild(prototypeId, 1, "successful", "2026-10-02T00:00:00Z", "2026-10-02T00:00:00Z")
    await createBuild(prototypeId, 2, "failed", "2026-10-03T00:00:00Z", "2026-10-03T00:00:00Z")
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "entra",
      login: "member",
      name: "Member",
      role: "MEMBER",
    })

    await withServer(restore, async (baseUrl) => {
      const headers = { cookie: "hub_session=member-session" }
      for (const selection of ["abc", "0", "-1", "1.5", "99", "2"]) {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}?build=${selection}`,
          { headers },
        )
        expect(response.status, `build=${selection}`).toBe(404)
      }
    })
  })

  it("requires a current session and revalidates membership before returning detail", async () => {
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
    const member = {
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER" as const,
    }

    await withServer(vi.fn().mockResolvedValue(null), async (baseUrl) => {
      const headerSets: Record<string, string>[] = [{}, { cookie: "hub_session=expired-session" }]
      for (const headers of headerSets) {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}`,
          { headers },
        )
        expect(response.status).toBe(401)
        expect(await response.text()).not.toContain("Private prototype")
      }
    })

    const restore = vi
      .fn()
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce({
        ...member,
        membershipId: randomUUID(),
      })
    await withServer(restore, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}`,
        { headers: { cookie: "hub_session=member-session" } },
      )
      expect(response.status).toBe(401)
      expect(await response.text()).not.toContain("Private prototype")
      expect(restore).toHaveBeenCalledTimes(2)
    })
  })
})
