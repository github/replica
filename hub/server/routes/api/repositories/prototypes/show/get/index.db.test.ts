import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import pg from "pg"
import { describe, expect, it, vi } from "vitest"

import { getDatabaseUrl } from "../../../../../../../test/database/get-database-url"
import { waitForBlockedQuery } from "../../../../../../../test/database/wait-for-blocked-query"
import { createApp } from "../../../../../../create-app"
import { sameSitePreviewReaderSetting } from "../../../../../../integrations/express/hub-session-cookie-name"
import { prisma } from "../../../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../../../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../../../../product/create-product-route-dependencies"
import type { AuthenticationRouteDependencies } from "../../../../auth/types"

async function createViewer(
  token = "member-session",
  expiresAt = new Date("2099-01-01T00:00:00Z"),
  options: { administrator?: boolean; profileProvider?: string; repositoryIdToGrant?: string } = {},
) {
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
  const provider = await prisma.authenticationProvider.findUniqueOrThrow({
    where: { key: "github" },
  })
  const user = await prisma.user.create({
    data: {
      profile: { create: { provider: options.profileProvider ?? "github", login: randomUUID() } },
    },
  })
  const identity = await prisma.externalIdentity.create({
    data: { userId: user.id, provider: "github", issuer: "https://github.com", subject: user.id },
  })
  const membership = await prisma.membership.create({
    data: {
      userId: user.id,
      assignments: {
        create: options.administrator
          ? {
              externalIdentityId: identity.id,
              source: "BOOTSTRAP",
              role: "ADMINISTRATOR",
            }
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
  const session = await prisma.hubSession.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      providerRevisionId: provider.selectedRevisionId,
      digest: createHash("sha256").update(token).digest("hex"),
      revocationRevision: 0,
      expiresAt,
    },
  })
  if (options.repositoryIdToGrant) {
    await prisma.repositoryAccessGrant.create({
      data: {
        membershipId: membership.id,
        repositoryId: options.repositoryIdToGrant,
        observedAt: new Date(),
      },
    })
  }
  return {
    restore: authentication.currentSession.restore.bind(authentication.currentSession),
    user,
    membership,
    session,
    token,
  }
}

async function createPrototype(
  options: { githubRepositoryId?: number; grantExistingMembers?: boolean } = {},
) {
  const repository = await prisma.repository.create({
    data: {
      githubRepositoryId: options.githubRepositoryId ?? 1001,
      nameWithOwner: "team/design",
      defaultBranch: "main",
    },
  })
  if (options.grantExistingMembers !== false) {
    const memberships = await prisma.membership.findMany({ select: { id: true } })
    if (memberships.length) {
      await prisma.repositoryAccessGrant.createMany({
        data: memberships.map(({ id }) => ({
          membershipId: id,
          repositoryId: repository.id,
          observedAt: new Date(),
        })),
      })
    }
  }
  return prisma.prototype.create({
    data: { branchName: "prototype/checkout", repositoryId: repository.id },
  })
}

async function withServer(
  restore: AuthenticationRouteDependencies["currentSession"]["restore"],
  operation: (baseUrl: string) => Promise<void>,
  options: { scopeGitHubMembers: boolean } = { scopeGitHubMembers: false },
  protectedSession = false,
) {
  const authentication: AuthenticationRouteDependencies = {
    currentSession: { restore },
    signOut: { applicationOrigin: "http://127.0.0.1:5173", secureCookie: false, end: vi.fn() },
  }
  const app = createApp({ authentication, product: createProductRouteDependencies(options) })
  if (protectedSession) app.set(sameSitePreviewReaderSetting, true)
  const server = createServer(app)
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
  it("uses the session identity and current repository grant before recording an introduction", async () => {
    const member = await createViewer("member-session", undefined, { profileProvider: "entra" })
    const administrator = await createViewer("administrator-session", undefined, {
      administrator: true,
    })
    const prototype = await createPrototype({
      githubRepositoryId: 1001,
      grantExistingMembers: false,
    })
    const commitSha = "a".repeat(40)
    await prisma.build.create({
      data: { prototypeId: prototype.id, number: 1, state: "successful", commitSha },
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
    const restore = vi.fn(member.restore)

    await withServer(
      restore,
      async (baseUrl) => {
        const url = `${baseUrl}/api/repositories/${prototype.repositoryId}/prototypes/${prototype.id}?build=1`
        const headers = { cookie: `hub_session=${member.token}` }
        const denied = await fetch(url, { headers })
        expect(denied.status).toBe(404)
        expect(await prisma.prototypeIntroduction.count()).toBe(0)

        const admin = await fetch(url, {
          headers: { cookie: `hub_session=${administrator.token}` },
        })
        expect(admin.status).toBe(200)
        expect(await admin.json()).toMatchObject({
          selectedBuild: { number: 1, commitSha },
          showPrototypeInfo: true,
        })

        await prisma.repositoryAccessGrant.create({
          data: {
            membershipId: member.membership.id,
            repositoryId: prototype.repositoryId,
            observedAt: new Date(),
          },
        })
        const granted = await fetch(url, { headers })
        expect(granted.status).toBe(200)
        expect(await granted.json()).toMatchObject({
          prototype: { id: prototype.id, canEdit: true },
          selectedBuild: { number: 1, commitSha },
          showPrototypeInfo: true,
        })
        const introductions = await prisma.prototypeIntroduction.findMany({
          select: { userId: true, prototypeId: true },
        })
        expect(introductions).toEqual(
          expect.arrayContaining([
            { userId: member.user.id, prototypeId: prototype.id },
            { userId: administrator.user.id, prototypeId: prototype.id },
          ]),
        )
        expect(introductions).toHaveLength(2)

        restore.mockImplementationOnce(async (digest) => {
          const current = await member.restore(digest)
          await prisma.repositoryAccessGrant.deleteMany({
            where: { membershipId: member.membership.id, repositoryId: prototype.repositoryId },
          })
          return current
        })
        expect((await fetch(url, { headers })).status).toBe(404)
        expect(await prisma.prototypeIntroduction.count()).toBe(2)

        const legacyToken = "legacy-session"
        await prisma.hubSession.create({
          data: {
            ...member.session,
            id: randomUUID(),
            digest: createHash("sha256").update(legacyToken).digest("hex"),
            externalIdentityId: null,
            providerRevisionId: null,
          },
        })
        const legacyHeaders = { cookie: `hub_session=${legacyToken}` }
        expect((await fetch(url, { headers: legacyHeaders })).status).toBe(404)
        await prisma.repositoryAccessGrant.create({
          data: {
            membershipId: member.membership.id,
            repositoryId: prototype.repositoryId,
            observedAt: new Date(),
          },
        })
        const unknownProvider = await fetch(url, { headers: legacyHeaders })
        expect(unknownProvider.status).toBe(200)
        expect(await unknownProvider.json()).toMatchObject({ showPrototypeInfo: false })
        const mismatchedToken = "mismatched-session"
        await prisma.hubSession.create({
          data: {
            ...member.session,
            id: randomUUID(),
            digest: createHash("sha256").update(mismatchedToken).digest("hex"),
            externalIdentityId: administrator.session.externalIdentityId,
          },
        })
        expect(
          (
            await fetch(url, {
              headers: { cookie: `hub_session=${mismatchedToken}` },
            })
          ).status,
        ).toBe(401)
        await prisma.hubSession.update({
          where: { id: member.session.id },
          data: { endedAt: new Date() },
        })
        expect((await fetch(url, { headers })).status).toBe(401)
        expect(await prisma.prototypeIntroduction.count()).toBe(2)
      },
      { scopeGitHubMembers: true },
    )
  })

  it("shows the introduction once for each user and prototype", async () => {
    const first = await createViewer()
    const second = await createViewer("second-session")
    const prototype = await createPrototype()
    const other = await prisma.prototype.create({
      data: { repositoryId: prototype.repositoryId, branchName: "prototype/other" },
    })
    const laterToken = "another-session"
    await prisma.hubSession.create({
      data: {
        ...first.session,
        id: randomUUID(),
        digest: createHash("sha256").update(laterToken).digest("hex"),
      },
    })
    await withServer(first.restore, async (baseUrl) => {
      const url = `${baseUrl}/api/repositories/${prototype.repositoryId}/prototypes/${prototype.id}`
      const headers = { cookie: `hub_session=${first.token}` }
      const initial = await fetch(url, { headers })
      expect(initial.status).toBe(200)
      expect(await initial.json()).toMatchObject({
        prototype: { canEdit: true },
        showPrototypeInfo: true,
      })
      const introduction = await prisma.prototypeIntroduction.findFirstOrThrow()

      const later = await fetch(`${url}?view=gallery`, {
        headers: { cookie: `hub_session=${laterToken}` },
      })
      expect(later.status).toBe(200)
      expect(await later.json()).toMatchObject({ showPrototypeInfo: false })
      expect(await prisma.prototypeIntroduction.findMany()).toEqual([introduction])

      const anotherUser = await fetch(`${url}?view=list`, {
        headers: { cookie: `hub_session=${second.token}`, "if-none-match": "*" },
      })
      expect(anotherUser.status).toBe(200)
      expect(await anotherUser.json()).toMatchObject({ showPrototypeInfo: true })
      const anotherPrototype = await fetch(
        `${baseUrl}/api/repositories/${other.repositoryId}/prototypes/${other.id}`,
        { headers },
      )
      expect(anotherPrototype.status).toBe(200)
      expect(await anotherPrototype.json()).toMatchObject({ showPrototypeInfo: true })
      expect(
        await prisma.prototypeIntroduction.findMany({
          select: { userId: true, prototypeId: true },
        }),
      ).toEqual(
        expect.arrayContaining([
          { userId: first.user.id, prototypeId: prototype.id },
          { userId: second.user.id, prototypeId: prototype.id },
          { userId: first.user.id, prototypeId: other.id },
        ]),
      )
    })
  })

  it("does not consume an introduction in minimized views", async () => {
    const { restore } = await createViewer()
    const prototype = await createPrototype()
    await withServer(restore, async (baseUrl) => {
      const url = `${baseUrl}/api/repositories/${prototype.repositoryId}/prototypes/${prototype.id}`
      const headers = { cookie: "hub_session=member-session" }
      const minimized = await fetch(`${url}?view=minimized`, { headers })
      expect(minimized.status).toBe(200)
      expect(await minimized.json()).toMatchObject({
        prototype: { canEdit: true },
        showPrototypeInfo: false,
      })
      expect(await prisma.prototypeIntroduction.count()).toBe(0)

      const normal = await fetch(url, { headers })
      expect(normal.status).toBe(200)
      expect(await normal.json()).toMatchObject({ showPrototypeInfo: true })
    })
  })

  it("records an introduction only from Hub itself while the private reader shares its site", async () => {
    const { restore, token } = await createViewer()
    const prototype = await createPrototype()
    await withServer(
      restore,
      async (baseUrl) => {
        const url = `${baseUrl}/api/repositories/${prototype.repositoryId}/prototypes/${prototype.id}`
        const cookie = `hub_session=${token}`
        const unknownSource = await fetch(url, { headers: { cookie } })
        expect(unknownSource.status).toBe(200)
        expect(await unknownSource.json()).toMatchObject({ showPrototypeInfo: false })
        expect(await prisma.prototypeIntroduction.count()).toBe(0)

        const fromHub = await fetch(url, { headers: { cookie, "sec-fetch-site": "same-origin" } })
        expect(fromHub.status).toBe(200)
        expect(await fromHub.json()).toMatchObject({ showPrototypeInfo: true })
        expect(await prisma.prototypeIntroduction.count()).toBe(1)
      },
      undefined,
      true,
    )
  })

  it("does not consume an introduction for a HEAD request", async () => {
    const { restore } = await createViewer()
    const prototype = await createPrototype()
    await withServer(restore, async (baseUrl) => {
      const url = `${baseUrl}/api/repositories/${prototype.repositoryId}/prototypes/${prototype.id}`
      const headers = { cookie: "hub_session=member-session" }
      const response = await fetch(url, { method: "HEAD", headers })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe("")
      expect(await prisma.prototypeIntroduction.count()).toBe(0)
    })
  })

  it("rolls back the introduction when response JSON cannot be prepared", async () => {
    const { restore } = await createViewer()
    const prototype = await createPrototype()
    await withServer(restore, async (baseUrl) => {
      const url = `${baseUrl}/api/repositories/${prototype.repositoryId}/prototypes/${prototype.id}`
      const headers = { cookie: "hub_session=member-session" }
      const stringify = JSON.stringify
      const serialization = vi.spyOn(JSON, "stringify").mockImplementation((value, ...options) => {
        const detail = value as { prototype?: { id?: string } } | undefined
        if (detail?.prototype?.id === prototype.id && "showPrototypeInfo" in detail) {
          return stringify({ ...detail, unrenderable: 1n })
        }
        return stringify(value, ...options)
      })
      const failed = await fetch(url, { headers })
      serialization.mockRestore()
      expect(failed.status).toBe(500)
      expect(await prisma.prototypeIntroduction.count()).toBe(0)

      const retried = await fetch(url, { headers })
      expect(retried.status).toBe(200)
      expect(await retried.json()).toMatchObject({ showPrototypeInfo: true })
    })
  })

  it("leaves introductions untouched by invalid addresses or disconnected repositories", async () => {
    const { restore, membership } = await createViewer()
    const prototype = await createPrototype()
    const otherRepository = await prisma.repository.create({
      data: { githubRepositoryId: 1002, nameWithOwner: "team/other", defaultBranch: "main" },
    })
    await prisma.repositoryAccessGrant.create({
      data: {
        membershipId: membership.id,
        repositoryId: otherRepository.id,
        observedAt: new Date(),
      },
    })
    await withServer(restore, async (baseUrl) => {
      const url = `${baseUrl}/api/repositories/${prototype.repositoryId}/prototypes/${prototype.id}`
      const headers = { cookie: "hub_session=member-session" }
      expect((await fetch(`${url}?view=unknown`, { headers })).status).toBe(400)
      expect(
        (await fetch(`${baseUrl}/api/repositories/invalid/prototypes/${prototype.id}`, { headers }))
          .status,
      ).toBe(400)
      expect(
        (
          await fetch(
            `${baseUrl}/api/repositories/${otherRepository.id}/prototypes/${prototype.id}`,
            {
              headers,
            },
          )
        ).status,
      ).toBe(404)
      await prisma.repository.update({
        where: { id: prototype.repositoryId },
        data: { removedAt: new Date() },
      })
      expect((await fetch(url, { headers })).status).toBe(404)
      expect(await prisma.prototypeIntroduction.count()).toBe(0)
    })
  })

  it("rechecks session expiry after waiting for prototype access", async () => {
    const expiresAt = new Date(Date.now() + 3_000)
    const viewer = await createViewer("member-session", expiresAt)
    const prototype = await createPrototype()
    await withServer(viewer.restore, async (baseUrl) => {
      const blocker = new pg.Client({ connectionString: getDatabaseUrl() })
      const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
      await Promise.all([blocker.connect(), inspector.connect()])
      let pending: Promise<Response> | undefined
      try {
        await blocker.query("BEGIN")
        await blocker.query("SELECT id FROM prototypes WHERE id = $1 FOR UPDATE", [prototype.id])
        const { pid } = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows[0]!
        pending = fetch(
          `${baseUrl}/api/repositories/${prototype.repositoryId}/prototypes/${prototype.id}`,
          { headers: { cookie: `hub_session=${viewer.token}` } },
        )
        await vi.waitFor(() => waitForBlockedQuery(inspector, pid, "prototypes"), {
          timeout: 2_000,
        })
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 50)),
        )
        await blocker.query("COMMIT")
        expect((await pending).status).toBe(401)
        expect(await prisma.prototypeIntroduction.count()).toBe(0)
      } finally {
        await blocker.query("ROLLBACK")
        if (pending) await Promise.allSettled([pending])
        await Promise.all([blocker.end(), inspector.end()])
      }
    })
  })

  it("records only one introduction for overlapping first views", async () => {
    const viewer = await createViewer()
    const prototype = await createPrototype()
    let arrivals = 0
    let release!: () => void
    const bothAuthenticated = new Promise<void>((resolve) => {
      release = resolve
    })
    async function restore(digest: string) {
      const session = await viewer.restore(digest)
      arrivals += 1
      if (arrivals === 2) release()
      await bothAuthenticated
      return session
    }
    await withServer(restore, async (baseUrl) => {
      const blocker = new pg.Client({ connectionString: getDatabaseUrl() })
      const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
      await Promise.all([blocker.connect(), inspector.connect()])
      const pending: Array<Promise<Response>> = []
      try {
        await blocker.query("BEGIN")
        await blocker.query("LOCK TABLE prototype_introductions IN SHARE MODE")
        const { pid } = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows[0]!
        const url = `${baseUrl}/api/repositories/${prototype.repositoryId}/prototypes/${prototype.id}`
        const headers = { cookie: "hub_session=member-session" }
        pending.push(fetch(url, { headers }))
        pending.push(fetch(url, { headers }))
        await vi.waitFor(() => waitForBlockedQuery(inspector, pid, "prototype_introductions"), {
          timeout: 2_000,
        })
        await blocker.query("COMMIT")
        const responses = await Promise.all(pending)
        expect(responses.map(({ status }) => status)).toEqual([200, 200])
        const details = await Promise.all(
          responses.map(
            async (response) => response.json() as Promise<{ showPrototypeInfo: boolean }>,
          ),
        )
        expect(details.map(({ showPrototypeInfo }) => showPrototypeInfo).sort()).toEqual([
          false,
          true,
        ])
        expect(await prisma.prototypeIntroduction.count()).toBe(1)
      } finally {
        release()
        await blocker.query("ROLLBACK")
        await Promise.allSettled(pending)
        await Promise.all([blocker.end(), inspector.end()])
      }
    })
  })

  it("returns stored non-GitHub author profiles", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: {
        id: repositoryId,
        githubRepositoryId: 1001,
        nameWithOwner: "team/design",
        defaultBranch: "main",
      },
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
    const { restore } = await createViewer("member-session", undefined, {
      repositoryIdToGrant: repositoryId,
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
      data: {
        id: repositoryId,
        githubRepositoryId: 1001,
        nameWithOwner: "team/design",
        defaultBranch: "main",
      },
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
    const { restore } = await createViewer("member-session", undefined, {
      repositoryIdToGrant: repositoryId,
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
      expect(defaultDetail).toMatchObject({
        selectedBuild: { number: 5 },
        showPrototypeInfo: true,
      })

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
      expect(selectedDetail).toMatchObject({
        selectedBuild: { number: 2, commitSha: null, commitAuthorLogin: null },
        showPrototypeInfo: false,
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
      data: {
        id: repositoryId,
        githubRepositoryId: 1001,
        nameWithOwner: "team/design",
        defaultBranch: "main",
      },
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
    const { restore, user } = await createViewer("member-session", undefined, {
      repositoryIdToGrant: repositoryId,
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
        canEdit: true,
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
      expect(
        await prisma.prototypeIntroduction.findMany({
          where: { userId: user.id },
          select: { prototypeId: true },
          orderBy: { prototypeId: "asc" },
        }),
      ).toEqual([unregisteredId, deletedBranchId].sort().map((prototypeId) => ({ prototypeId })))
    })
  })

  it("returns no selected Build when the prototype has no successful Build", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    await prisma.repository.create({
      data: {
        id: repositoryId,
        githubRepositoryId: 1001,
        nameWithOwner: "team/design",
        defaultBranch: "main",
      },
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
    const { restore } = await createViewer("member-session", undefined, {
      repositoryIdToGrant: repositoryId,
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
      data: {
        id: repositoryId,
        githubRepositoryId: 1001,
        nameWithOwner: "team/design",
        defaultBranch: "main",
      },
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
    const { restore } = await createViewer("member-session", undefined, {
      repositoryIdToGrant: repositoryId,
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
      expect(await prisma.prototypeIntroduction.count()).toBe(0)
    })
  })

  it("requires a current session and revalidates membership before returning detail", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    await prisma.repository.create({
      data: {
        id: repositoryId,
        githubRepositoryId: 1001,
        nameWithOwner: "team/private",
        defaultBranch: "main",
      },
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

    const viewer = await createViewer("member-session", undefined, {
      repositoryIdToGrant: repositoryId,
    })
    const member = await viewer.restore(viewer.session.digest)
    const restore = vi.fn().mockResolvedValueOnce({
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
      expect(await prisma.prototypeIntroduction.count()).toBe(0)
    })
  })
})
