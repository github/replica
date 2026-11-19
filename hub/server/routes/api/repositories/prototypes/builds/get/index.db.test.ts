import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../../../../create-app"
import { prisma } from "../../../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../../../auth/create-authentication-route-dependencies"
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
    latestBuild: { number: number; state: string } | null
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
  options: { scopeGitHubMembers: boolean } = { scopeGitHubMembers: false },
) {
  const authentication: AuthenticationRouteDependencies = {
    currentSession: { restore },
    signOut: { applicationOrigin: "http://127.0.0.1:5173", secureCookie: false, end: vi.fn() },
  }
  const server = createServer(
    createApp({ authentication, product: createProductRouteDependencies(options) }),
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

async function createSession(
  identityProvider: "github" | "entra",
  profileProvider: "github" | "entra",
  administrator = false,
) {
  const provider = await prisma.authenticationProvider.findUniqueOrThrow({
    where: { key: identityProvider },
  })
  const login = randomUUID()
  const user = await prisma.user.create({
    data: { profile: { create: { provider: profileProvider, login } } },
  })
  const identity = await prisma.externalIdentity.create({
    data: {
      userId: user.id,
      provider: identityProvider,
      issuer:
        identityProvider === "github"
          ? "https://github.com"
          : "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0",
      subject: user.id,
    },
  })
  const membership = await prisma.membership.create({
    data: {
      userId: user.id,
      assignments: {
        create: administrator
          ? { externalIdentityId: identity.id, source: "BOOTSTRAP", role: "ADMINISTRATOR" }
          : {
              externalIdentityId: identity.id,
              providerRevisionId: provider.selectedRevisionId,
              providerAssignmentSubject: identity.subject,
              source: "AUTHENTICATION_PROVIDER",
              role: "MEMBER",
            },
      },
    },
  })
  const token = randomUUID()
  const session = await prisma.hubSession.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      providerRevisionId: provider.selectedRevisionId,
      digest: createHash("sha256").update(token).digest("hex"),
      revocationRevision: 0,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    },
  })
  return { membership, session, token, user, login }
}

describe("prototype Build history API", () => {
  it("uses the authenticated identity and current grant for paginated Build history", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const authentication = await createAuthenticationRouteDependencies({
      GITHUB_CLIENT_ID: "test-client",
      GITHUB_CLIENT_SECRET: "test-secret",
      GITHUB_PROVIDER_REVISION: "1",
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(
        privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      ).toString("base64"),
      GITHUB_WEBHOOK_SECRET: "test-webhook-secret-at-least-20-characters",
      HUB_APPLICATION_ORIGIN: "http://127.0.0.1:5173",
      HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      HUB_BOOTSTRAP_SECRET: "test-bootstrap-secret-at-least-32-characters",
    })
    const member = await createSession("github", "entra")
    const administrator = await createSession("github", "github", true)
    const entraProvider = await prisma.authenticationProvider.create({
      data: { enabled: false, key: "entra" },
    })
    const entraRevision = await prisma.authenticationProviderRevision.create({
      data: { providerId: entraProvider.id, revision: 1, configurationDigest: "a".repeat(64) },
    })
    await prisma.authenticationProvider.update({
      where: { id: entraProvider.id },
      data: { enabled: true, selectedRevisionId: entraRevision.id },
    })
    const entraMember = await createSession("entra", "github")
    const repository = await prisma.repository.create({
      data: { githubRepositoryId: 1001, nameWithOwner: "team/private", defaultBranch: "main" },
    })
    const retained = await prisma.repository.create({
      data: { githubRepositoryId: 1002, nameWithOwner: "team/retained", defaultBranch: "main" },
    })
    await prisma.repositoryAccessGrant.create({
      data: {
        membershipId: member.membership.id,
        repositoryId: retained.id,
        observedAt: new Date(),
      },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "prototype/private", name: "Private" },
    })
    await prisma.build.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        prototypeId: prototype.id,
        number: index + 1,
        state: "successful",
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
      })),
    })
    const restoreSession = authentication.currentSession.restore.bind(authentication.currentSession)
    const restore = vi.fn(restoreSession)

    await withServer(
      restore,
      async (baseUrl) => {
        const url = `${baseUrl}/api/repositories/${repository.id}/prototypes/${prototype.id}/builds?page=2&build=26`
        const headers = { cookie: `hub_session=${member.token}` }
        async function expectPublicViewer(viewer: typeof member, provider: "github" | "entra") {
          const viewerHeaders = { cookie: `hub_session=${viewer.token}` }
          const session = await fetch(`${baseUrl}/api/auth/session`, { headers: viewerHeaders })
          expect(session.status).toBe(200)
          expect(await session.json()).toEqual({
            authenticated: true,
            membershipId: viewer.membership.id,
            userId: viewer.user.id,
            provider,
            reviewInboxAvailable: true,
            login: viewer.login,
            name: null,
            role: "MEMBER",
          })
          const workspace = await fetch(`${baseUrl}/api/workspace`, { headers: viewerHeaders })
          expect(workspace.status).toBe(200)
          const body = (await workspace.json()) as { viewer: unknown }
          expect(body.viewer).toEqual({
            id: viewer.user.id,
            login: viewer.login,
            name: null,
            provider,
            avatarUrl: null,
          })
          expect(body).not.toHaveProperty("sessionProvider")
        }

        await expectPublicViewer(member, "entra")
        await expectPublicViewer(entraMember, "github")
        expect((await fetch(url, { headers })).status).toBe(404)

        await prisma.repositoryAccessGrant.create({
          data: {
            membershipId: member.membership.id,
            repositoryId: repository.id,
            observedAt: new Date(),
          },
        })
        const granted = await fetch(url, { headers })
        expect(granted.status).toBe(200)
        const history = (await granted.json()) as BuildHistoryBody
        expect(history.pagination).toEqual({ page: 2, pageSize: 25, totalCount: 26, pageCount: 2 })
        expect(history.builds.map(({ number }) => number)).toEqual([1])
        expect(history.prototype.builds.map(({ number }) => number)).toEqual([26, 1])
        expect(history.prototype.latestBuild).toEqual({ number: 26, state: "successful" })

        restore.mockImplementationOnce(async (digest) => {
          const current = await restoreSession(digest)
          await prisma.repositoryAccessGrant.deleteMany({
            where: { membershipId: member.membership.id, repositoryId: repository.id },
          })
          return current
        })
        expect((await fetch(url, { headers })).status).toBe(404)

        for (const token of [administrator.token, entraMember.token]) {
          const response = await fetch(url, { headers: { cookie: `hub_session=${token}` } })
          expect(response.status).toBe(200)
          expect(await response.json()).toMatchObject({
            builds: [{ number: 1 }],
            pagination: { page: 2, totalCount: 26 },
          })
        }

        await prisma.repositoryAccessGrant.create({
          data: {
            membershipId: member.membership.id,
            repositoryId: repository.id,
            observedAt: new Date(),
          },
        })
        await prisma.hubSession.update({
          where: { id: member.session.id },
          data: { endedAt: new Date() },
        })
        expect((await fetch(url, { headers })).status).toBe(401)
        expect(await prisma.prototypeIntroduction.count()).toBe(0)
      },
      { scopeGitHubMembers: true },
    )
  })

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
    await prisma.build.createMany({
      data: Array.from({ length: buildCount }, (_, index) => {
        const createdAt = new Date(Date.UTC(2026, 9, 2, buildCount - (index === 1 ? 0 : index)))
        return {
          prototypeId,
          number: index + 1,
          state: states[index % states.length],
          workflowCreatedAt: index % 2 ? createdAt : null,
          createdAt: index % 2 ? new Date("2026-11-01T00:00:00Z") : createdAt,
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
      sessionProvider: "github",
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
      expect(pageSize).toBe(25)
      const pageCount = Math.ceil(buildCount / pageSize)
      expect(pageCount).toBeGreaterThan(1)
      expect(first.pagination).toEqual({ page: 1, pageSize, totalCount: buildCount, pageCount })
      expect(first.builds).toHaveLength(pageSize)
      expect(first.prototype.builds.map(({ number }) => number)).toEqual(
        first.builds.map(({ number }) => number),
      )
      expect(first.repository.id).toBe(repositoryId)
      expect(first.prototype).toMatchObject({
        id: prototypeId,
        repositoryId,
        name: "Checkout",
        startPage: "/checkout",
        canEdit: true,
        latestBuild: { number: 2, state: "failed" },
      })
      expect(await prisma.prototypeIntroduction.count()).toBe(0)

      const builds = [...first.builds]
      for (let page = 2; page <= pageCount; page += 1) {
        const response = await fetch(`${historyUrl}?page=${page}`, { headers })
        expect(response.status).toBe(200)
        const next = (await response.json()) as BuildHistoryBody
        expect(next.pagination).toEqual({ page, pageSize, totalCount: buildCount, pageCount })
        expect(next.builds).toHaveLength(Math.min(pageSize, buildCount - (page - 1) * pageSize))
        expect(next.prototype.builds.map(({ number }) => number)).toEqual(
          next.builds.map(({ number }) => number),
        )
        expect(next.prototype.latestBuild).toEqual({ number: 2, state: "failed" })
        builds.push(...next.builds)
      }

      expect(builds.map(({ number }) => number)).toEqual([
        2,
        1,
        ...Array.from({ length: buildCount - 2 }, (_, index) => index + 3),
      ])
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

  it("adds only a successful off-page pin to the picker without changing the page", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    const otherPrototypeId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.prototype.createMany({
      data: [
        { id: prototypeId, repositoryId, branchName: "prototype/checkout" },
        { id: otherPrototypeId, repositoryId, branchName: "prototype/other" },
      ],
    })
    const states = ["successful", "failed", "running", "queued", "superseded"] as const
    await prisma.build.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        prototypeId,
        number: index + 1,
        state: states[index] ?? "successful",
        createdAt: new Date(Date.UTC(2026, 9, index + 1)),
      })),
    })
    await prisma.build.create({
      data: { prototypeId: otherPrototypeId, number: 99, state: "successful" },
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })

    await withServer(restore, async (baseUrl) => {
      const historyUrl = `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds`
      const headers = { cookie: "hub_session=member-session" }
      const pageNumbers = Array.from({ length: 25 }, (_, index) => 30 - index)
      const pinnedResponse = await fetch(`${historyUrl}?build=1`, { headers })
      expect(pinnedResponse.status).toBe(200)
      const pinned = (await pinnedResponse.json()) as BuildHistoryBody
      expect(pinned.builds.map(({ number }) => number)).toEqual(pageNumbers)
      expect(pinned.prototype.builds.map(({ number }) => number)).toEqual([...pageNumbers, 1])
      expect(pinned.pagination).toEqual({
        page: 1,
        pageSize: 25,
        totalCount: 30,
        pageCount: 2,
      })

      for (const pin of [30, 2, 3, 4, 5, 99, 100]) {
        const response = await fetch(`${historyUrl}?build=${pin}`, { headers })
        expect(response.status, `build=${pin}`).toBe(200)
        const history = (await response.json()) as BuildHistoryBody
        expect(
          history.prototype.builds.map(({ number }) => number),
          `build=${pin}`,
        ).toEqual(pageNumbers)
        expect(history.builds.map(({ number }) => number)).toEqual(pageNumbers)
      }

      const olderResponse = await fetch(`${historyUrl}?page=2&build=30`, { headers })
      expect(olderResponse.status).toBe(200)
      const older = (await olderResponse.json()) as BuildHistoryBody
      expect(older.builds.map(({ number }) => number)).toEqual([5, 4, 3, 2, 1])
      expect(older.prototype.builds.map(({ number }) => number).sort((a, b) => b - a)).toEqual([
        30, 5, 4, 3, 2, 1,
      ])
      expect(await prisma.prototypeIntroduction.count()).toBe(0)
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
      sessionProvider: "entra",
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
      expect(history.prototype.builds).toEqual([])
      expect(history.pagination).toMatchObject({ page: 1, totalCount: 0, pageCount: 1 })
      expect(
        (
          await fetch(
            `${baseUrl}/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds?page=2`,
            { headers: { cookie: "hub_session=member-session" } },
          )
        ).status,
      ).toBe(404)
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
      sessionProvider: "github",
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
      sessionProvider: "github",
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
