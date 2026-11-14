import { createHash, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import pg from "pg"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { getDatabaseUrl } from "../../../../../../../test/database/get-database-url"
import { waitForBlockedQuery } from "../../../../../../../test/database/wait-for-blocked-query"
import { waitForDatabaseLock } from "../../../../../../../test/database/wait-for-database-lock"
import { createApp } from "../../../../../../create-app"
import { endAllHubSessions } from "../../../../../../domains/session-revocation/end-all-hub-sessions"
import { prisma } from "../../../../../../integrations/prisma"
import { lockEditablePrototype } from "../../../../../../repositories/prototypes/lock-editable-prototype"
import { createAuthenticationRouteDependencies } from "../../../../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../../../../product/create-product-route-dependencies"

const origin = "http://127.0.0.1:5173"

async function openServer() {
  const authentication = await createAuthenticationRouteDependencies({
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    GITHUB_PROVIDER_REVISION: "1",
    HUB_APPLICATION_ORIGIN: origin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: "test-bootstrap-secret-at-least-32-characters",
  })
  const server = createServer(
    createApp({ authentication, product: createProductRouteDependencies() }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  const { port } = server.address() as AddressInfo
  return { authentication, url: `http://127.0.0.1:${port}` }
}

async function createMember(options: { administrator?: boolean; expiresAt?: Date } = {}) {
  const provider = await prisma.authenticationProvider.findUniqueOrThrow({
    where: { key: "github" },
  })
  const user = await prisma.user.create({
    data: { profile: { create: { provider: "github", login: randomUUID() } } },
  })
  const identity = await prisma.externalIdentity.create({
    data: { userId: user.id, provider: "github", issuer: "https://github.com", subject: user.id },
  })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  const assignment = await prisma.membershipAssignment.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      ...(options.administrator
        ? { source: "BOOTSTRAP" as const, role: "ADMINISTRATOR" as const }
        : {
            providerRevisionId: provider.selectedRevisionId,
            providerAssignmentSubject: identity.subject,
            source: "AUTHENTICATION_PROVIDER" as const,
            role: "MEMBER" as const,
          }),
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
      expiresAt: options.expiresAt ?? new Date("2099-01-01T00:00:00Z"),
    },
  })
  return { user, membership, assignment, session, token }
}

async function createPrototype(
  serverUrl: string,
  branchName: string,
  options: { authorId?: string; draft?: boolean; name?: string } = {},
) {
  const repository = await prisma.repository.create({
    data: { nameWithOwner: "team/design", defaultBranch: "main" },
  })
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId: repository.id,
      branchName,
      ...(options.draft
        ? {}
        : {
            authorId: options.authorId,
            name: options.name ?? branchName,
            registeredAt: new Date("2026-10-01T00:00:00Z"),
          }),
    },
  })
  const url = `${serverUrl}/api/repositories/${repository.id}/prototypes/${prototype.id}`
  return { repository, prototype, url }
}

function readPrototype(id: string) {
  return prisma.prototype.findUniqueOrThrow({ where: { id } })
}

function patch(url: string, token: string, body: unknown) {
  return fetch(url, {
    method: "PATCH",
    headers: { origin, cookie: `hub_session=${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("prototype PATCH API", () => {
  it("renames a registered prototype and preserves its author, identity and Builds", async () => {
    const server = await openServer()
    const first = await createMember()
    const second = await createMember()
    const { repository, prototype, url } = await createPrototype(
      server.url,
      "prototype/registered",
      { authorId: first.user.id, name: "Original" },
    )
    const build = await prisma.build.create({
      data: { prototypeId: prototype.id, number: 1, state: "successful" },
    })
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { currentBuildId: build.id },
    })
    const visible = await fetch(url, { headers: { cookie: `hub_session=${first.token}` } })
    expect(visible.status).toBe(200)

    const renamed = await patch(url, first.token, { name: " \u2003Welcome\u00a0 " })
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toMatchObject({
      prototype: {
        id: prototype.id,
        repositoryId: repository.id,
        name: "Welcome",
        description: null,
        canEdit: false,
      },
      selectedBuild: { number: 1, prototypeId: prototype.id },
    })
    const registration = await readPrototype(prototype.id)
    expect(registration).toMatchObject({
      authorId: first.user.id,
      registeredAt: prototype.registeredAt,
      name: "Welcome",
    })

    const updated = await patch(url, second.token, { name: "Renamed" })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      prototype: { name: "Renamed", description: null },
    })
    expect(await readPrototype(prototype.id)).toMatchObject({
      id: prototype.id,
      authorId: first.user.id,
      registeredAt: registration.registeredAt,
      createdAt: prototype.createdAt,
      branchName: prototype.branchName,
      currentBuildId: build.id,
    })
    expect(await prisma.build.findUniqueOrThrow({ where: { id: build.id } })).toEqual(build)
  })

  it("accepts Unicode name limits and rejects invalid edits without changing a prototype", async () => {
    const server = await openServer()
    const member = await createMember()
    const { prototype, url } = await createPrototype(server.url, "prototype/limits")

    const empty = await patch(url, member.token, {})
    expect(empty.status).toBe(400)
    const blankName = await patch(url, member.token, { name: "\u0085\u00a0\u2003 " })
    expect(blankName.status).toBe(400)
    const longName = await patch(url, member.token, { name: "😀".repeat(256) })
    expect(longName.status).toBe(400)
    expect(await readPrototype(prototype.id)).toEqual(prototype)

    const maximum = await patch(url, member.token, { name: ` ${"😀".repeat(255)} ` })
    expect(maximum.status).toBe(200)
    expect(await maximum.json()).toMatchObject({
      prototype: { name: "😀".repeat(255) },
    })
    const saved = await readPrototype(prototype.id)
    const blankRegistered = await patch(url, member.token, { name: " " })
    expect(blankRegistered.status).toBe(400)
    expect(await readPrototype(prototype.id)).toEqual(saved)
  })

  it("uses detail visibility and preserves unknown first authors on retired branches", async () => {
    const server = await openServer()
    const member = await createMember()
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "trunk" },
    })
    const registeredAt = new Date("2026-10-01T00:00:00Z")
    const retired = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "prototype/retired",
        name: "Retired",
        registeredAt,
        branchDeletedAt: new Date("2026-10-02T00:00:00Z"),
      },
    })
    const retiredUrl = `${server.url}/api/repositories/${repository.id}/prototypes/${retired.id}`
    const response = await patch(retiredUrl, member.token, { name: "Edited" })
    expect(response.status).toBe(200)
    expect(await readPrototype(retired.id)).toMatchObject({
      authorId: null,
      registeredAt,
      branchDeletedAt: retired.branchDeletedAt,
    })
    const hidden = await prisma.prototype.createManyAndReturn({
      data: [
        { repositoryId: repository.id, branchName: "trunk" },
        { repositoryId: repository.id, branchName: "replica/install-workflow" },
        { repositoryId: repository.id, branchName: "replica/internal", replica: true },
      ],
    })
    for (const prototype of hidden) {
      const denied = await patch(
        `${server.url}/api/repositories/${repository.id}/prototypes/${prototype.id}`,
        member.token,
        { name: "Changed" },
      )
      expect(denied.status).toBe(404)
      expect(await readPrototype(prototype.id)).toEqual(prototype)
    }
    const other = await prisma.repository.create({
      data: { nameWithOwner: "team/other", defaultBranch: "main" },
    })
    const wrongRepository = await patch(
      `${server.url}/api/repositories/${other.id}/prototypes/${retired.id}`,
      member.token,
      { name: "Wrong repository" },
    )
    expect(wrongRepository.status).toBe(404)
    await prisma.repository.update({
      where: { id: repository.id },
      data: { removedAt: new Date() },
    })
    const removedRepository = await patch(retiredUrl, member.token, {
      name: "Removed repository",
    })
    expect(removedRepository.status).toBe(404)
    expect((await readPrototype(retired.id)).name).toBe("Edited")
  })

  it("checks origin before JSON parsing for every Express alias", async () => {
    const server = await openServer()
    const restore = vi.spyOn(server.authentication.currentSession, "restore")
    const path = `/api/repositories/${randomUUID()}/prototypes/${randomUUID()}`
    for (const address of [path, `${path.toUpperCase()}/`]) {
      const response = await fetch(`${server.url}${address}`, {
        method: "PATCH",
        headers: { origin: "https://other.example.test", "content-type": "application/json" },
        body: "{",
      })
      expect(response.status).toBe(403)
    }
    expect(restore).not.toHaveBeenCalled()
    const malformed = await fetch(`${server.url}${path}`, {
      method: "PATCH",
      headers: { origin, "content-type": "application/json" },
      body: "{",
    })
    expect(malformed.status).toBe(400)
  })

  it("rolls back metadata and repository changes when the prototype becomes unavailable", async () => {
    const server = await openServer()
    const member = await createMember()
    const { prototype, repository, url } = await createPrototype(server.url, "prototype/rollback")
    const database = new pg.Client({ connectionString: getDatabaseUrl() })
    await database.connect()
    const trigger = `hide_repository_${randomUUID().replaceAll("-", "")}`
    try {
      await database.query(`
        CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          UPDATE repositories
          SET removed_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = NEW.repository_id;
          RETURN NEW;
        END $$;
        CREATE TRIGGER "${trigger}" AFTER UPDATE ON prototypes
        FOR EACH ROW EXECUTE FUNCTION "${trigger}"();
      `)
      const response = await patch(url, member.token, { name: "Changed" })
      expect(response.status).toBe(500)
      expect(await readPrototype(prototype.id)).toEqual(prototype)
      expect(await prisma.repository.findUniqueOrThrow({ where: { id: repository.id } })).toEqual(
        repository,
      )
    } finally {
      await database.query(
        `DROP TRIGGER IF EXISTS "${trigger}" ON prototypes; DROP FUNCTION IF EXISTS "${trigger}"()`,
      )
      await database.end()
    }
  })

  it("holds repository visibility until the edit commits", async () => {
    const { repository, prototype } = await createPrototype("", "prototype/visibility")
    const database = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([database.connect(), inspector.connect()])
    let notifyEditReady!: () => void
    const editReady = new Promise<void>((resolve) => {
      notifyEditReady = resolve
    })
    let releaseEdit!: () => void
    const editGate = new Promise<void>((resolve) => {
      releaseEdit = resolve
    })
    let editPid: number | undefined
    let edit: Promise<void> | null = null
    let defaultBranchChange: Promise<pg.QueryResult> | null = null
    try {
      edit = prisma.$transaction(async (transaction) => {
        expect(await lockEditablePrototype(transaction, repository.id, prototype.id)).toMatchObject(
          { id: prototype.id, registeredAt: prototype.registeredAt },
        )
        const [connection] = await transaction.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `
        if (!connection) throw new Error("The edit transaction has no PostgreSQL connection.")
        editPid = connection.pid
        await transaction.prototype.update({
          where: { id: prototype.id },
          data: { name: "Edited" },
        })
        notifyEditReady()
        await editGate
      })
      await Promise.race([
        editReady,
        edit.then(() => {
          throw new Error("The edit finished before holding the repository lock.")
        }),
      ])
      if (editPid === undefined) throw new Error("The edit transaction has no PostgreSQL PID.")
      defaultBranchChange = database.query(
        `UPDATE repositories
         SET default_branch = 'trunk', updated_at = clock_timestamp()
         WHERE id = $1`,
        [repository.id],
      )
      await waitForBlockedQuery(inspector, editPid, "UPDATE repositories")

      releaseEdit()
      await edit
      await defaultBranchChange
      expect(await readPrototype(prototype.id)).toMatchObject({ name: "Edited" })
      expect(
        await prisma.repository.findUniqueOrThrow({ where: { id: repository.id } }),
      ).toMatchObject({ defaultBranch: "trunk" })
    } finally {
      releaseEdit()
      if (edit) await Promise.allSettled([edit])
      if (defaultBranchChange) await Promise.allSettled([defaultBranchChange])
      await Promise.all([database.end(), inspector.end()])
    }
  })

  it("rejects an edit when its session expires while waiting for the prototype lock", async () => {
    const server = await openServer()
    const expiresAt = new Date(Date.now() + 3_000)
    const member = await createMember({ expiresAt })
    const { prototype, url } = await createPrototype(server.url, "prototype/session-expiry")
    const database = new pg.Client({ connectionString: getDatabaseUrl() })
    await database.connect()
    let transactionOpen = false
    let edit: Promise<Response> | null = null
    try {
      await database.query("BEGIN")
      transactionOpen = true
      await database.query("SELECT id FROM prototypes WHERE id = $1 FOR UPDATE", [prototype.id])
      edit = patch(url, member.token, { name: "Expired" })
      await waitForDatabaseLock(getDatabaseUrl())
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 100)),
      )
      await database.query("COMMIT")
      transactionOpen = false
      expect((await edit).status).toBe(401)
      expect(await readPrototype(prototype.id)).toEqual(prototype)
    } finally {
      if (transactionOpen) await database.query("ROLLBACK")
      if (edit) await Promise.allSettled([edit])
      await database.end()
    }
  })

  it("commits an edit before global session revocation waiting on its lock", async () => {
    const server = await openServer()
    const member = await createMember()
    const { prototype, url } = await createPrototype(server.url, "prototype/session-revocation")
    const database = new pg.Client({ connectionString: getDatabaseUrl() })
    const revoker = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([database.connect(), revoker.connect()])
    let transactionOpen = false
    let edit: Promise<Response> | null = null
    let revisionUpdate: Promise<pg.QueryResult> | null = null
    try {
      await database.query("BEGIN")
      transactionOpen = true
      await database.query("SELECT id FROM prototypes WHERE id = $1 FOR UPDATE", [prototype.id])
      edit = patch(url, member.token, { name: "Before revocation" })
      await waitForDatabaseLock(getDatabaseUrl())
      revisionUpdate = revoker.query(`
        UPDATE session_revocation_states
        SET revision = revision + 1, updated_at = clock_timestamp()
        WHERE key = 'global'
        RETURNING revision
      `)
      await vi.waitFor(async () => {
        const waiting = await database.query<{ blocked: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database()
               AND wait_event_type = 'Lock'
               AND query LIKE '%UPDATE session_revocation_states%'
           ) AS blocked`,
        )
        expect(waiting.rows[0]?.blocked).toBe(true)
      })
      await database.query("COMMIT")
      transactionOpen = false
      expect((await edit).status).toBe(200)
      await revisionUpdate
      const saved = await readPrototype(prototype.id)
      expect(saved.name).toBe("Before revocation")
      expect((await patch(url, member.token, { name: "After revocation" })).status).toBe(401)
      expect(await readPrototype(prototype.id)).toEqual(saved)
    } finally {
      if (transactionOpen) await database.query("ROLLBACK")
      if (edit) await Promise.allSettled([edit])
      if (revisionUpdate) await Promise.allSettled([revisionUpdate])
      await Promise.all([database.end(), revoker.end()])
    }
  })

  it("rejects missing sessions and session or assignment revocation after initial authentication", async () => {
    const server = await openServer()
    const member = await createMember()
    const { prototype, url } = await createPrototype(server.url, "prototype/private")
    expect((await patch(url, "", { name: "Changed" })).status).toBe(401)
    const restore = server.authentication.currentSession.restore.bind(
      server.authentication.currentSession,
    )
    const restoreSpy = vi.spyOn(server.authentication.currentSession, "restore")
    restoreSpy.mockImplementationOnce(async (digest) => {
      const current = await restore(digest)
      await prisma.hubSession.update({
        where: { id: member.session.id },
        data: { endedAt: new Date() },
      })
      return current
    })
    expect((await patch(url, member.token, { name: "Changed" })).status).toBe(401)
    expect(await readPrototype(prototype.id)).toEqual(prototype)

    const other = await createMember()
    restoreSpy.mockImplementationOnce(async (digest) => {
      const current = await restore(digest)
      await prisma.membershipAssignment.update({
        where: { id: other.assignment.id },
        data: { lifecycle: "REVOKED" },
      })
      return current
    })
    expect((await patch(url, other.token, { name: "Changed" })).status).toBe(401)
    expect(await readPrototype(prototype.id)).toEqual(prototype)
  })

  it("does not edit a draft before registration is enabled", async () => {
    const server = await openServer()
    const member = await createMember()
    const { prototype, url } = await createPrototype(server.url, "prototype/draft", {
      draft: true,
    })
    const denied = await patch(url, member.token, { name: "Must remain a draft" })
    expect(denied.status).toBe(404)
    expect(await readPrototype(prototype.id)).toEqual(prototype)
  })

  it("denies an admin edit blocked behind successful session revocation", async () => {
    const server = await openServer()
    const admin = await createMember({ administrator: true })
    const { prototype, url } = await createPrototype(server.url, "prototype/admin-revocation")
    const { revision } = await prisma.sessionRevocationState.findUniqueOrThrow({
      select: { revision: true },
      where: { key: "global" },
    })
    const authorizationId = randomUUID()
    await prisma.sensitiveAuthorization.create({
      data: {
        actorMembershipId: admin.membership.id,
        expiresAt: new Date(Date.now() + 60_000),
        externalIdentityId: admin.assignment.externalIdentityId,
        hubSessionId: admin.session.id,
        id: authorizationId,
        operation: "END_ALL_HUB_SESSIONS",
        targetMembershipIds: [],
        verifiedAt: new Date(),
      },
    })
    const viewer = await server.authentication.currentSession.restore(
      createHash("sha256").update(admin.token).digest("hex"),
    )
    expect(viewer).toMatchObject({ membershipId: admin.membership.id })
    const blocker = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([blocker.connect(), inspector.connect()])
    let blockerOpen = false
    let revocation: ReturnType<typeof endAllHubSessions> | null = null
    let edit: Promise<Response> | null = null
    try {
      await blocker.query("BEGIN")
      blockerOpen = true
      await blocker.query("SELECT id FROM hub_sessions WHERE id = $1 FOR UPDATE", [
        admin.session.id,
      ])
      const { pid: blockerPid } = (
        await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      revocation = endAllHubSessions(prisma, {
        authorizationId,
        hubSessionId: admin.session.id,
      })
      const revocationPid = await waitForBlockedQuery(inspector, blockerPid, "hub_sessions")

      vi.spyOn(server.authentication.currentSession, "restore").mockResolvedValueOnce(viewer)
      edit = patch(url, admin.token, { name: "Must not commit" })
      await waitForBlockedQuery(inspector, revocationPid, "authentication_providers")

      await blocker.query("COMMIT")
      blockerOpen = false
      await expect(revocation).resolves.toMatchObject({ revision: revision + 1 })
      expect((await edit).status).toBe(401)
      expect(await readPrototype(prototype.id)).toEqual(prototype)
    } finally {
      if (blockerOpen) await blocker.query("ROLLBACK")
      if (revocation) await Promise.allSettled([revocation])
      if (edit) await Promise.allSettled([edit])
      await Promise.all([blocker.end(), inspector.end()])
    }
  }, 20_000)
})
