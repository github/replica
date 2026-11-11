import { createHash, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import pg from "pg"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../create-app"
import { prisma } from "../../../integrations/prisma"
import { findRepositoryIndex } from "../../../repositories/prototype-index/find-repository-index"
import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import type { AuthenticationRouteDependencies } from "../auth/types"
import { createProductRouteDependencies } from "../product/create-product-route-dependencies"
import type { ProductRouteDependencies } from "../product/types"

async function withServer(
  restore: AuthenticationRouteDependencies["currentSession"]["restore"],
  product: ProductRouteDependencies,
  operation: (baseUrl: string) => Promise<void>,
) {
  const authentication: AuthenticationRouteDependencies = {
    currentSession: { restore },
    signOut: { applicationOrigin: "http://127.0.0.1:5173", secureCookie: false, end: vi.fn() },
  }
  const server = createServer(createApp({ authentication, product }))
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

describe("real product index", () => {
  it("lists active repositories and only reviewable prototypes for GitHub and Entra members", async () => {
    const repositoryId = randomUUID()
    const anotherRepositoryId = randomUUID()
    const removedRepositoryId = randomUUID()
    const authorId = randomUUID()
    const olderId = "10000000-0000-4000-8000-000000000001"
    const tiedId = "10000000-0000-4000-8000-000000000002"
    const newestId = "10000000-0000-4000-8000-000000000003"
    const replicaNamedId = "10000000-0000-4000-8000-000000000004"
    const registeredAt = new Date("2026-10-01T12:00:00Z")
    const olderPrototypes = [
      {
        id: randomUUID(),
        repositoryId,
        branchName: "main",
        name: "Non-default main",
        registeredAt: new Date("2026-09-01T00:00:00Z"),
      },
      ...Array.from({ length: 22 }, (_, index) => ({
        id: randomUUID(),
        repositoryId,
        branchName: `prototype/older-${index}`,
        name: `Older ${index}`,
        registeredAt: new Date("2026-09-01T00:00:00Z"),
      })),
    ]
    await prisma.repository.createMany({
      data: [
        { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "trunk" },
        { id: anotherRepositoryId, nameWithOwner: "team/other", defaultBranch: "main" },
        {
          id: removedRepositoryId,
          nameWithOwner: "team/removed",
          defaultBranch: "main",
          removedAt: new Date("2026-11-01T00:00:00Z"),
        },
      ],
    })
    await prisma.user.create({ data: { id: authorId } })
    await prisma.userProfile.create({
      data: { userId: authorId, provider: "github", login: "mona", name: "Mona" },
    })
    await prisma.prototype.createMany({
      data: [
        {
          id: olderId,
          repositoryId,
          authorId,
          branchName: "prototype/older",
          name: "Older",
          registeredAt,
          createdAt: new Date("2026-11-01T00:00:00Z"),
        },
        {
          id: tiedId,
          repositoryId,
          branchName: "prototype/unattributed",
          name: "Unattributed",
          registeredAt,
          createdAt: new Date("2026-09-01T00:00:00Z"),
        },
        {
          id: newestId,
          repositoryId,
          authorId,
          branchName: "prototype/newest",
          name: "Newest",
          registeredAt: new Date("2026-10-02T12:00:00Z"),
          createdAt: new Date("2026-08-01T00:00:00Z"),
        },
        { repositoryId, branchName: "prototype/draft", name: "Draft" },
        {
          repositoryId,
          branchName: "prototype/deleted",
          name: "Deleted",
          registeredAt,
          branchDeletedAt: new Date("2026-10-03T00:00:00Z"),
        },
        { repositoryId, branchName: "trunk", name: "Default branch", registeredAt },
        {
          id: replicaNamedId,
          repositoryId,
          branchName: "replica/default-branch",
          name: "A reviewable branch",
          registeredAt,
        },
        {
          repositoryId,
          branchName: "replica/install-workflow",
          name: "Install workflow",
          registeredAt,
        },
        { repositoryId, branchName: "replica/internal", replica: true },
        {
          repositoryId: anotherRepositoryId,
          branchName: "prototype/other",
          name: "Other repository",
          registeredAt,
        },
        ...olderPrototypes,
      ],
    })

    const githubSession = {
      membershipId: randomUUID(),
      userId: authorId,
      provider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER" as const,
    }
    const entraSession = {
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "entra",
      login: "member",
      name: "Member",
      role: "MEMBER" as const,
    }
    const githubToken = "github-session"
    const entraToken = "entra-session"
    function hash(value: string) {
      return createHash("sha256").update(value).digest("hex")
    }
    const restore = vi.fn((digest: string) => {
      if (digest === hash(githubToken)) return Promise.resolve(githubSession)
      if (digest === hash(entraToken)) return Promise.resolve(entraSession)
      return Promise.resolve(null)
    })
    await withServer(restore, createProductRouteDependencies(), async (baseUrl) => {
      for (const [token, session] of [
        [githubToken, githubSession],
        [entraToken, entraSession],
      ] as const) {
        const headers = { cookie: `hub_session=${token}` }
        const workspaceResponse = await fetch(`${baseUrl}/api/workspace`, { headers })
        expect(workspaceResponse.status).toBe(200)
        expect(workspaceResponse.headers.get("cache-control")).toBe("no-store")
        const workspace = (await workspaceResponse.json()) as {
          viewer: { id: string; login: string }
          repositories: { id: string }[]
          capabilities: {
            createPrototypes: boolean
            reviewPrototypes: boolean
            manageSharing: boolean
          }
        }
        expect(workspace.viewer).toMatchObject({ id: session.userId, login: session.login })
        expect(workspace.repositories.map(({ id }) => id).sort()).toEqual(
          [repositoryId, anotherRepositoryId].sort(),
        )
        expect(workspace.capabilities).toMatchObject({
          createPrototypes: false,
          reviewPrototypes: false,
          manageSharing: false,
        })

        const indexResponse = await fetch(`${baseUrl}/api/repositories/${repositoryId}`, {
          headers,
        })
        expect(indexResponse.status).toBe(200)
        expect(indexResponse.headers.get("cache-control")).toBe("no-store")
        const index = (await indexResponse.json()) as {
          repository: { id: string; nameWithOwner: string }
          prototypes: {
            id: string
            authorLogin: string | null
            canEdit: boolean
            builds: unknown[]
          }[]
          pagination: { page: number; pageSize: number; totalCount: number; pageCount: number }
          authors: { id: string; login: string }[]
        }
        expect(index.repository).toMatchObject({ id: repositoryId, nameWithOwner: "team/design" })
        expect(index.pagination).toEqual({ page: 1, pageSize: 24, totalCount: 27, pageCount: 2 })
        expect(index.prototypes.map(({ id }) => id)).toEqual([
          newestId,
          replicaNamedId,
          tiedId,
          olderId,
          ...olderPrototypes
            .map(({ id }) => id)
            .sort()
            .reverse()
            .slice(0, 20),
        ])
        expect(
          index.prototypes.every(({ canEdit, builds }) => !canEdit && builds.length === 0),
        ).toBe(true)
        expect(index.prototypes.find(({ id }) => id === tiedId)?.authorLogin ?? null).toBeNull()
        expect(index.authors).toContainEqual(
          expect.objectContaining({ id: authorId, login: "mona" }),
        )
        expect(index.authors).toHaveLength(1)
        const secondPage = await fetch(`${baseUrl}/api/repositories/${repositoryId}?page=2`, {
          headers,
        })
        expect(secondPage.status).toBe(200)
        const second = (await secondPage.json()) as typeof index
        expect(second.pagination).toMatchObject({ page: 2, totalCount: 27, pageCount: 2 })
        expect(second.prototypes.map(({ id }) => id)).toEqual(
          olderPrototypes
            .map(({ id }) => id)
            .sort()
            .reverse()
            .slice(20),
        )
        const anotherResponse = await fetch(`${baseUrl}/api/repositories/${anotherRepositoryId}`, {
          headers,
        })
        expect(anotherResponse.status).toBe(200)
      }

      expect(restore).toHaveBeenCalledWith(hash(githubToken))
      expect(restore).toHaveBeenCalledWith(hash(entraToken))
    })
  })

  it("searches, filters by user, and pages through users with prototypes", async () => {
    const repositoryId = randomUUID()
    const viewerId = randomUUID()
    const monaId = randomUUID()
    const hiddenAuthorId = randomUUID()
    const otherIds = Array.from({ length: 20 }, () => randomUUID())
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.user.createMany({
      data: [viewerId, monaId, hiddenAuthorId, ...otherIds].map((id) => ({ id })),
    })
    await prisma.userProfile.createMany({
      data: [
        { userId: viewerId, provider: "entra", login: "viewer@example.test", name: "Viewer" },
        { userId: monaId, provider: "github", login: "mona", name: "Mona Lisa" },
        { userId: hiddenAuthorId, provider: "github", login: "hidden", name: "Hidden" },
        ...otherIds.map((userId, index) => ({
          userId,
          provider: "github",
          login: `user-${String(index).padStart(2, "0")}`,
        })),
      ],
    })
    const registeredAt = new Date("2026-10-01T00:00:00Z")
    const viewerPrototypeId = randomUUID()
    const monaPrototypeId = randomUUID()
    await prisma.prototype.createMany({
      data: [
        {
          id: viewerPrototypeId,
          repositoryId,
          authorId: viewerId,
          branchName: "prototype/checkout",
          name: "Checkout",
          description: "Save 100% faster",
          registeredAt,
        },
        {
          id: monaPrototypeId,
          repositoryId,
          authorId: monaId,
          branchName: "prototype/onboarding",
          name: "Onboarding",
          registeredAt,
        },
        {
          repositoryId,
          authorId: hiddenAuthorId,
          branchName: "prototype/draft",
          name: "Draft",
        },
        ...otherIds.map((authorId, index) => ({
          repositoryId,
          authorId,
          branchName: `prototype/other-${index}`,
          name: `Other ${index}`,
          registeredAt,
        })),
      ],
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: viewerId,
      provider: "entra",
      login: "viewer@example.test",
      name: "Viewer",
      role: "MEMBER",
    })
    const headers = { cookie: "hub_session=member-session" }

    await withServer(restore, createProductRouteDependencies(), async (baseUrl) => {
      async function index(query: string) {
        const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}?${query}`, {
          headers,
        })
        expect(response.status).toBe(200)
        return (await response.json()) as {
          prototypes: { id: string }[]
          pagination: { page: number; totalCount: number; pageCount: number }
          authors: { id: string }[]
        }
      }
      async function authors(query: string) {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/authors?${query}`,
          { headers },
        )
        expect(response.status).toBe(200)
        return (await response.json()) as {
          authors: { id: string; login: string }[]
          nextCursor: string | null
        }
      }

      for (const query of ["q=%20ONBOARD%20", "q=lisa", "q=prototype%2Fonb"]) {
        expect((await index(query)).prototypes.map(({ id }) => id)).toEqual([monaPrototypeId])
      }
      expect((await index("q=100%25")).prototypes.map(({ id }) => id)).toEqual([viewerPrototypeId])
      expect((await index("q=1_0")).prototypes).toEqual([])
      expect((await index("author=me")).prototypes.map(({ id }) => id)).toEqual([viewerPrototypeId])
      const monaIndex = await index(`author=${monaId}&page=9`)
      expect(monaIndex.prototypes.map(({ id }) => id)).toEqual([monaPrototypeId])
      expect(monaIndex.pagination).toMatchObject({ page: 1, totalCount: 1, pageCount: 1 })
      const noMatches = await index(`author=${monaId}&q=checkout`)
      expect(noMatches.prototypes).toEqual([])
      expect(noMatches.authors.map(({ id }) => id)).toEqual([monaId])

      for (const query of ["page=0", "page=1.5", "author=42", "q[]=a", "view=list"]) {
        const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}?${query}`, {
          headers,
        })
        expect(response.status).toBe(400)
      }

      const firstAuthors = await authors("")
      expect(firstAuthors.authors.map(({ login }) => login)).toEqual([
        "mona",
        ...otherIds.slice(0, 19).map((_, index) => `user-${String(index).padStart(2, "0")}`),
      ])
      expect(firstAuthors.nextCursor).not.toBeNull()
      const nextAuthors = await authors(`cursor=${firstAuthors.nextCursor}`)
      expect(nextAuthors).toEqual({
        authors: [expect.objectContaining({ id: otherIds[19], login: "user-19" })],
        nextCursor: null,
      })
      expect((await authors("q=LISA")).authors.map(({ id }) => id)).toEqual([monaId])

      const badCursor = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/authors?cursor=not-a-cursor`,
        { headers },
      )
      expect(badCursor.status).toBe(400)
    })
  })

  it("does not disclose product data without a current session", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "private/design", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/secret",
        name: "Private prototype",
        registeredAt: new Date("2026-10-01T00:00:00Z"),
      },
    })
    const restore = vi.fn().mockResolvedValue(null)
    const headerSets: Record<string, string>[] = [{}, { cookie: "hub_session=expired-session" }]

    await withServer(restore, createProductRouteDependencies(), async (baseUrl) => {
      for (const path of [
        "/api/workspace",
        `/api/repositories/${repositoryId}`,
        `/api/repositories/${repositoryId}/authors`,
      ]) {
        for (const headers of headerSets) {
          const response = await fetch(`${baseUrl}${path}`, { headers })
          expect(response.status).toBe(401)
          const body = await response.text()
          expect(body).not.toContain("private/design")
          expect(body).not.toContain("Private prototype")
        }
      }
      expect(restore).toHaveBeenCalledWith(
        createHash("sha256").update("expired-session").digest("hex"),
      )
    })
  })

  it("does not return data when the session is revoked during a product read", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "private/design", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/secret",
        name: "Private prototype",
        registeredAt: new Date("2026-10-01T00:00:00Z"),
      },
    })
    const activeSession = {
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER" as const,
    }
    let currentSession: typeof activeSession | null = activeSession
    const restore = vi.fn(() => Promise.resolve(currentSession))
    const product = createProductRouteDependencies()
    const listRepositories = product.listRepositories.bind(product)
    const findRepositoryIndex = product.findRepositoryIndex.bind(product)
    const list = vi.spyOn(product, "listRepositories").mockImplementation(async () => {
      const repositories = await listRepositories()
      currentSession = null
      return repositories
    })
    const findRepositoryAuthors = product.findRepositoryAuthors.bind(product)
    const find = vi
      .spyOn(product, "findRepositoryIndex")
      .mockImplementation(async (id, filters) => {
        const index = await findRepositoryIndex(id, filters)
        currentSession = null
        return index
      })
    const findAuthors = vi
      .spyOn(product, "findRepositoryAuthors")
      .mockImplementation(async (id, filters) => {
        const authors = await findRepositoryAuthors(id, filters)
        currentSession = null
        return authors
      })

    await withServer(restore, product, async (baseUrl) => {
      for (const path of [
        "/api/workspace",
        `/api/repositories/${repositoryId}`,
        `/api/repositories/${repositoryId}/authors`,
      ]) {
        currentSession = activeSession
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { cookie: "hub_session=member-session" },
        })

        expect(response.status).toBe(401)
        const body = await response.text()
        expect(body).not.toContain("private/design")
        expect(body).not.toContain("Private prototype")
      }
      expect(list).toHaveBeenCalledOnce()
      expect(find).toHaveBeenCalledOnce()
      expect(findAuthors).toHaveBeenCalledOnce()
    })
  })

  it("uses the current role after reading the workspace", async () => {
    const session = {
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "entra",
      login: "member",
      name: "Member",
      role: "MEMBER" as "MEMBER" | "ADMINISTRATOR",
    }
    let currentSession = session
    let roleAfterRead: "MEMBER" | "ADMINISTRATOR" = "MEMBER"
    const restore = vi.fn(() => Promise.resolve(currentSession))
    const product = createProductRouteDependencies()
    const listRepositories = product.listRepositories.bind(product)
    vi.spyOn(product, "listRepositories").mockImplementation(async () => {
      const repositories = await listRepositories()
      currentSession = { ...currentSession, role: roleAfterRead }
      return repositories
    })

    await withServer(restore, product, async (baseUrl) => {
      for (const [before, after] of [
        ["MEMBER", "ADMINISTRATOR"],
        ["ADMINISTRATOR", "MEMBER"],
      ] as const) {
        currentSession = { ...session, role: before }
        roleAfterRead = after
        const response = await fetch(`${baseUrl}/api/workspace`, {
          headers: { cookie: "hub_session=member-session" },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          capabilities: { administerHub: after === "ADMINISTRATOR" },
        })
      }
    })
  })

  it("distinguishes malformed, missing, and removed repositories", async () => {
    const removedId = randomUUID()
    await prisma.repository.create({
      data: {
        id: removedId,
        nameWithOwner: "team/removed",
        defaultBranch: "main",
        removedAt: new Date("2026-11-01T00:00:00Z"),
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
    const headers = { cookie: "hub_session=member-session" }

    await withServer(restore, createProductRouteDependencies(), async (baseUrl) => {
      const malformed = await fetch(`${baseUrl}/api/repositories/not-a-uuid`, { headers })
      const missing = await fetch(`${baseUrl}/api/repositories/${randomUUID()}`, { headers })
      const removed = await fetch(`${baseUrl}/api/repositories/${removedId}`, { headers })

      expect(malformed.status).toBe(400)
      expect(missing.status).toBe(404)
      expect(removed.status).toBe(404)
    })
  })

  it("returns an error when the repository lookup fails", async () => {
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "entra",
      login: "member",
      name: "Member",
      role: "MEMBER",
    })
    const product = createProductRouteDependencies()
    vi.spyOn(product, "findRepositoryIndex").mockRejectedValueOnce(
      new Error("Database unavailable"),
    )

    await withServer(restore, product, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/repositories/${randomUUID()}`, {
        headers: { cookie: "hub_session=member-session" },
      })

      expect(response.status).toBe(500)
      expect(await response.json()).not.toHaveProperty("prototypes")
    })
  })

  it("keeps the prototype count consistent when a branch is retired during the read", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    const retiredAt = new Date("2026-11-10T00:00:00Z")
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: {
        id: prototypeId,
        repositoryId,
        branchName: "prototype/welcome",
        name: "Welcome",
        registeredAt: new Date(),
      },
    })
    const writer = new pg.Client({ connectionString: getDatabaseUrl() })
    onTestFinished(() => writer.end())
    await writer.connect()
    let retirement: Promise<void> | undefined
    async function readWhileRetiring<Result>(read: () => Promise<Result>) {
      if (!retirement) {
        const firstRead = read()
        retirement = firstRead.then(async () => {
          await writer.query("UPDATE prototypes SET branch_deleted_at = $1 WHERE id = $2", [
            retiredAt,
            prototypeId,
          ])
        })
        await retirement
        return firstRead
      }
      await retirement
      return read()
    }
    const reader = prisma.$extends({
      query: {
        prototype: {
          findMany({ args, query }) {
            return readWhileRetiring(() => query(args))
          },
          count({ args, query }) {
            return readWhileRetiring(() => query(args))
          },
        },
      },
    })
    // Prisma does not type an extended client as the base client.
    const database = reader as unknown as Parameters<typeof findRepositoryIndex>[0]
    const index = await findRepositoryIndex(database, repositoryId)

    expect(index).toMatchObject({
      prototypes: [{ id: prototypeId }],
      pagination: { totalCount: 1 },
    })
    expect(
      await prisma.prototype.findUnique({
        where: { id: prototypeId },
        select: { branchDeletedAt: true },
      }),
    ).toEqual({ branchDeletedAt: retiredAt })
  })

  it("does not return an index when a repository changes during the read", async () => {
    const removedId = randomUUID()
    const changedId = randomUUID()
    const removedPrototypeId = randomUUID()
    const changedPrototypeId = randomUUID()
    const removedAt = new Date("2026-11-10T00:00:00Z")
    await prisma.repository.createMany({
      data: [
        { id: removedId, nameWithOwner: "team/removed-after-read", defaultBranch: "main" },
        { id: changedId, nameWithOwner: "team/changed-after-read", defaultBranch: "main" },
      ],
    })
    await prisma.prototype.createMany({
      data: [
        {
          id: removedPrototypeId,
          repositoryId: removedId,
          branchName: "prototype/removed",
          name: "Removed repository prototype",
          registeredAt: new Date(),
        },
        {
          id: changedPrototypeId,
          repositoryId: changedId,
          branchName: "prototype/default",
          name: "New default branch",
          registeredAt: new Date(),
        },
      ],
    })
    const writer = new pg.Client({ connectionString: getDatabaseUrl() })
    onTestFinished(() => writer.end())
    await writer.connect()
    async function removeRepository() {
      await writer.query("UPDATE repositories SET removed_at = $1 WHERE id = $2", [
        removedAt,
        removedId,
      ])
    }
    async function changeDefaultBranch() {
      await writer.query("UPDATE repositories SET default_branch = $1 WHERE id = $2", [
        "prototype/default",
        changedId,
      ])
    }
    let changeRepository = removeRepository
    const prototypeIds: (string | undefined)[] = []
    const reader = prisma.$extends({
      query: {
        prototype: {
          async findMany({ args, query }) {
            const prototypes = await query(args)
            prototypeIds.push(...prototypes.map(({ id }) => id))
            await changeRepository()
            return prototypes
          },
        },
      },
    })
    const database = reader as unknown as Parameters<typeof findRepositoryIndex>[0]
    const removedIndex = await findRepositoryIndex(database, removedId)
    changeRepository = changeDefaultBranch
    const changedIndex = await findRepositoryIndex(database, changedId)

    expect(prototypeIds).toEqual([removedPrototypeId, changedPrototypeId])
    expect(
      await prisma.repository.findUnique({ where: { id: removedId }, select: { removedAt: true } }),
    ).toEqual({ removedAt })
    expect(
      await prisma.repository.findUnique({
        where: { id: changedId },
        select: { defaultBranch: true },
      }),
    ).toEqual({ defaultBranch: "prototype/default" })
    expect([removedIndex, changedIndex]).toEqual([null, null])
  })

  it("protects active branch and registration invariants while retaining deleted history", async () => {
    const first = new pg.Client({ connectionString: getDatabaseUrl() })
    const second = new pg.Client({ connectionString: getDatabaseUrl() })
    onTestFinished(async () => {
      await Promise.all([first.end(), second.end()])
    })
    await Promise.all([first.connect(), second.connect()])
    const repositoryId = randomUUID()
    await first.query(
      `INSERT INTO repositories (id, name_with_owner, default_branch)
       VALUES ($1, 'team/design', 'main')`,
      [repositoryId],
    )
    await first.query(
      `INSERT INTO prototypes (id, repository_id, branch_name, name, branch_deleted_at)
       VALUES ($1, $2, 'prototype/shared', 'Retired', clock_timestamp())`,
      [randomUUID(), repositoryId],
    )
    function insertActive(database: pg.Client) {
      return database.query(
        `INSERT INTO prototypes (id, repository_id, branch_name, name, registered_at)
         VALUES ($1, $2, 'prototype/shared', 'Active', clock_timestamp())`,
        [randomUUID(), repositoryId],
      )
    }
    const attempts = await Promise.allSettled([insertActive(first), insertActive(second)])
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    const rejected = attempts.find((attempt) => attempt.status === "rejected")
    expect(rejected).toMatchObject({ reason: { code: "23505" } })
    const versions = await first.query<{ active: boolean }>(
      `SELECT branch_deleted_at IS NULL AS active
       FROM prototypes WHERE repository_id = $1 AND branch_name = 'prototype/shared'
       ORDER BY active`,
      [repositoryId],
    )
    expect(versions.rows).toEqual([{ active: false }, { active: true }])

    for (const [branchName, name, replica] of [
      ["prototype/null-name", null, false],
      ["prototype/blank-name", "   ", false],
      ["prototype/whitespace-name", " \t\n ", false],
      ["prototype/next-line", "\u0085", false],
      ["prototype/no-break-space", "\u00a0", false],
      ["prototype/em-space", "\u2003", false],
      ["prototype/narrow-no-break-space", "\u202f", false],
      ["prototype/byte-order-mark", "\ufeff", false],
      ["replica/registered", "Replica", true],
    ] as const) {
      await expect(
        first.query(
          `INSERT INTO prototypes (id, repository_id, branch_name, name, registered_at, replica)
           VALUES ($1, $2, $3, $4, clock_timestamp(), $5)`,
          [randomUUID(), repositoryId, branchName, name, replica],
        ),
      ).rejects.toMatchObject({ code: "23514" })
    }
    await expect(
      first.query(
        `INSERT INTO prototypes (id, repository_id, branch_name, replica)
         VALUES ($1, $2, 'replica/unregistered', true)`,
        [randomUUID(), repositoryId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 })
  })
})
