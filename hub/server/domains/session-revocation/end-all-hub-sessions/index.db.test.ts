import { randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { continueAdministratorAuthorization } from "../../../domains/administrator-authorization/continue-administrator-authorization/index.ts"
import { prisma } from "../../../integrations/prisma"
import { getSessionRevocationStatus } from "../../../repositories/session-revocation-states/get-session-revocation-status"
import { endAllHubSessions } from "."

async function createProvider() {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  await prisma.authenticationProvider.create({
    data: { enabled: false, id: providerId, key: "github" },
  })
  await prisma.authenticationProviderRevision.create({
    data: {
      configurationDigest: "a".repeat(64),
      id: providerRevisionId,
      providerId,
      revision: 1,
    },
  })
  await prisma.authenticationProvider.update({
    data: { enabled: true, selectedRevisionId: providerRevisionId },
    where: { id: providerId },
  })
  return { providerId, providerRevisionId }
}

async function createMember(input: { administrator?: boolean; login: string }) {
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  await prisma.user.create({ data: { id: userId } })
  await prisma.externalIdentity.create({
    data: {
      id: externalIdentityId,
      issuer: "https://github.com",
      provider: "github",
      subject: randomUUID(),
      userId,
    },
  })
  await prisma.userProfile.create({
    data: { id: randomUUID(), login: input.login, provider: "github", userId },
  })
  await prisma.membership.create({ data: { id: membershipId, userId } })
  const assignmentId = randomUUID()
  if (input.administrator) {
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId,
        id: assignmentId,
        membershipId,
        role: "ADMINISTRATOR",
        source: "BOOTSTRAP",
      },
    })
  }
  return { assignmentId, externalIdentityId, membershipId, userId }
}

async function createSession(input: {
  digestCharacter: string
  externalIdentityId: string
  membershipId: string
  providerRevisionId: string
  revision: number
}) {
  const id = randomUUID()
  await prisma.hubSession.create({
    data: {
      digest: input.digestCharacter.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      externalIdentityId: input.externalIdentityId,
      id,
      membershipId: input.membershipId,
      providerRevisionId: input.providerRevisionId,
      revocationRevision: input.revision,
    },
  })
  return id
}

async function createFixture(input: { authorizationExpired?: boolean } = {}) {
  const { providerId, providerRevisionId } = await createProvider()
  const actor = await createMember({ administrator: true, login: "actor" })
  const other = await createMember({ login: "other" })
  const { revision } = await prisma.sessionRevocationState.findUniqueOrThrow({
    select: { revision: true },
    where: { key: "global" },
  })
  const actorSessionId = await createSession({
    digestCharacter: "b",
    externalIdentityId: actor.externalIdentityId,
    membershipId: actor.membershipId,
    providerRevisionId,
    revision,
  })
  const otherSessionId = await createSession({
    digestCharacter: "c",
    externalIdentityId: other.externalIdentityId,
    membershipId: other.membershipId,
    providerRevisionId,
    revision,
  })
  const authorizationId = randomUUID()
  await prisma.sensitiveAuthorization.create({
    data: {
      actorMembershipId: actor.membershipId,
      expiresAt: new Date(Date.now() + (input.authorizationExpired ? -60_000 : 60_000)),
      externalIdentityId: actor.externalIdentityId,
      hubSessionId: actorSessionId,
      id: authorizationId,
      operation: "END_ALL_HUB_SESSIONS",
      targetMembershipIds: [],
      verifiedAt: new Date(),
    },
  })
  const otherAuthorizationId = randomUUID()
  await prisma.sensitiveAuthorization.create({
    data: {
      actorMembershipId: actor.membershipId,
      expiresAt: new Date(Date.now() + 60_000),
      externalIdentityId: actor.externalIdentityId,
      hubSessionId: actorSessionId,
      id: otherAuthorizationId,
      operation: "DESIGNATE_ADMINISTRATORS",
      targetMembershipIds: [other.membershipId],
      verifiedAt: new Date(),
    },
  })
  await prisma.authorizationAttempt.create({
    data: {
      browserBindingDigest: "d".repeat(64),
      codeVerifierCiphertext: "encrypted-verifier",
      expiresAt: new Date(Date.now() + 60_000),
      id: randomUUID(),
      providerRevisionId,
      purpose: "SIGN_IN",
      sessionRevocationRevision: revision,
      stateDigest: "e".repeat(64),
    },
  })
  const repositoryId = randomUUID()
  await prisma.repository.create({
    data: {
      defaultBranch: "main",
      id: repositoryId,
      nameWithOwner: "github/unchanged",
    },
  })
  const prototypeId = randomUUID()
  await prisma.prototype.create({
    data: {
      branchName: "feature/unchanged",
      id: prototypeId,
      name: "Unchanged prototype",
      repositoryId,
    },
  })
  return {
    actor,
    actorSessionId,
    authorizationId,
    other,
    otherAuthorizationId,
    otherSessionId,
    providerId,
    prototypeId,
    revision,
  }
}

async function waitForBlockingQuery(inspector: pg.Client, blockerPid: number, query: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await inspector.query<{ pid: number }>(
      `SELECT waiter.pid
       FROM pg_stat_activity waiter
       WHERE waiter.datname = current_database()
         AND waiter.wait_event_type = 'Lock'
         AND waiter.query LIKE $2
         AND $1 = ANY(pg_blocking_pids(waiter.pid))
       LIMIT 1`,
      [blockerPid, `%${query}%`],
    )
    const waiterPid = result.rows[0]?.pid
    if (waiterPid) return waiterPid
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for a blocked query containing ${query}.`)
}

describe("endAllHubSessions()", () => {
  it("waits for revocation authority before locking the actor session or membership", async () => {
    const fixture = await createFixture()
    const authority = new pg.Client({ connectionString: getDatabaseUrl() })
    const provider = new pg.Client({ connectionString: getDatabaseUrl() })
    const contender = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([
      authority.connect(),
      provider.connect(),
      contender.connect(),
      inspector.connect(),
    ])
    let authorityOpen = false
    let providerOpen = false
    let contenderOpen = false
    let revocation: ReturnType<typeof endAllHubSessions> | null = null
    try {
      await provider.query("BEGIN")
      providerOpen = true
      await provider.query("SELECT id FROM authentication_providers WHERE id = $1 FOR UPDATE", [
        fixture.providerId,
      ])
      await authority.query("BEGIN")
      authorityOpen = true
      await authority.query(
        `SELECT revision FROM session_revocation_states WHERE key = 'global' FOR SHARE`,
      )
      const { pid: providerPid } = (
        await provider.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      const { pid: authorityPid } = (
        await authority.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      revocation = endAllHubSessions(prisma, {
        authorizationId: fixture.authorizationId,
        hubSessionId: fixture.actorSessionId,
      })
      await waitForBlockingQuery(inspector, providerPid, "authentication_providers")
      await provider.query("COMMIT")
      providerOpen = false
      await waitForBlockingQuery(inspector, authorityPid, "session_revocation_states")

      await contender.query("BEGIN")
      contenderOpen = true
      await contender.query("SELECT id FROM hub_sessions WHERE id = $1 FOR UPDATE NOWAIT", [
        fixture.actorSessionId,
      ])
      await contender.query("SELECT id FROM memberships WHERE id = $1 FOR UPDATE NOWAIT", [
        fixture.actor.membershipId,
      ])
      await contender.query("COMMIT")
      contenderOpen = false
      await authority.query("COMMIT")
      authorityOpen = false
      await expect(revocation).resolves.toMatchObject({ revision: fixture.revision + 1 })
    } finally {
      if (contenderOpen) await contender.query("ROLLBACK")
      if (providerOpen) await provider.query("ROLLBACK")
      if (authorityOpen) await authority.query("ROLLBACK")
      if (revocation) await Promise.allSettled([revocation])
      await Promise.all([authority.end(), provider.end(), contender.end(), inspector.end()])
    }
  })

  it("serializes administrator continuation with global session revocation", async () => {
    const fixture = await createFixture()
    const authority = new pg.Client({ connectionString: getDatabaseUrl() })
    const contender = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([authority.connect(), contender.connect(), inspector.connect()])
    let authorityOpen = false
    let contenderOpen = false
    let revocation: ReturnType<typeof endAllHubSessions> | null = null
    let continuation: ReturnType<typeof continueAdministratorAuthorization> | null = null
    try {
      await authority.query("BEGIN")
      authorityOpen = true
      await authority.query(
        "SELECT revision FROM session_revocation_states WHERE key = 'global' FOR UPDATE",
      )
      const { pid: authorityPid } = (
        await authority.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      revocation = endAllHubSessions(prisma, {
        authorizationId: fixture.authorizationId,
        hubSessionId: fixture.actorSessionId,
      })
      const revocationResult = revocation.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      )
      const revocationPid = await waitForBlockingQuery(
        inspector,
        authorityPid,
        "session_revocation_states",
      )
      continuation = continueAdministratorAuthorization(prisma, {
        hubSessionId: fixture.actorSessionId,
        id: fixture.otherAuthorizationId,
        operation: "DESIGNATE_ADMINISTRATORS",
        targetMembershipIds: [fixture.other.membershipId],
      })
      const continuationResult = continuation.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      )
      await waitForBlockingQuery(inspector, revocationPid, "authentication_providers")

      await contender.query("BEGIN")
      contenderOpen = true
      await contender.query("SELECT id FROM hub_sessions WHERE id = $1 FOR UPDATE NOWAIT", [
        fixture.actorSessionId,
      ])
      await contender.query("COMMIT")
      contenderOpen = false

      await authority.query("COMMIT")
      authorityOpen = false
      const [settledRevocation, settledContinuation] = await Promise.all([
        revocationResult,
        continuationResult,
      ])
      expect(settledRevocation).toMatchObject({
        status: "fulfilled",
        value: { revision: fixture.revision + 1 },
      })
      expect(settledContinuation).toMatchObject({
        status: "rejected",
        reason: { reason: "session_mismatch" },
      })
      expect(
        await prisma.securityAudit.count({
          where: { action: "session.revocation.end_all_failed" },
        }),
      ).toBe(0)
    } finally {
      if (contenderOpen) await contender.query("ROLLBACK")
      if (authorityOpen) await authority.query("ROLLBACK")
      if (revocation) await Promise.allSettled([revocation])
      if (continuation) await Promise.allSettled([continuation])
      await Promise.all([authority.end(), contender.end(), inspector.end()])
    }
  })

  it("atomically advances revocation, ends every session, cancels other authorization, and reports counts", async () => {
    const fixture = await createFixture()

    await expect(getSessionRevocationStatus(prisma)).resolves.toEqual({
      activeSessionCount: 2,
      pendingAuthenticationCount: 1,
      pendingSensitiveAuthorizationCount: 2,
      revision: fixture.revision,
    })
    await expect(
      endAllHubSessions(prisma, {
        authorizationId: fixture.authorizationId,
        hubSessionId: fixture.actorSessionId,
      }),
    ).resolves.toEqual({
      cancelledAuthorizationCount: 1,
      endedSessionCount: 2,
      revision: fixture.revision + 1,
    })

    await expect(getSessionRevocationStatus(prisma)).resolves.toEqual({
      activeSessionCount: 0,
      pendingAuthenticationCount: 0,
      pendingSensitiveAuthorizationCount: 0,
      revision: fixture.revision + 1,
    })
    const sessions = await prisma.hubSession.findMany({
      orderBy: { id: "asc" },
      select: { endedAt: true, id: true },
    })
    expect(sessions).toHaveLength(2)
    expect(sessions.every(({ endedAt }) => endedAt instanceof Date)).toBe(true)
    const continuedAuthorization = await prisma.sensitiveAuthorization.findUniqueOrThrow({
      select: { cancelledAt: true, continuedAt: true },
      where: { id: fixture.authorizationId },
    })
    expect(continuedAuthorization.cancelledAt).toBeNull()
    expect(continuedAuthorization.continuedAt).toBeInstanceOf(Date)
    const cancelledAuthorization = await prisma.sensitiveAuthorization.findUniqueOrThrow({
      select: { cancelledAt: true, continuedAt: true },
      where: { id: fixture.otherAuthorizationId },
    })
    expect(cancelledAuthorization.cancelledAt).toBeInstanceOf(Date)
    expect(cancelledAuthorization.continuedAt).toBeNull()
    await expect(
      prisma.securityAudit.findFirstOrThrow({
        select: { action: true, context: true, outcome: true },
        where: { action: "session.revocation.end_all" },
      }),
    ).resolves.toEqual({
      action: "session.revocation.end_all",
      context: {
        actorMembershipId: fixture.actor.membershipId,
        cancelledAuthorizationCount: 1,
        endedSessionCount: 2,
        revision: fixture.revision + 1,
      },
      outcome: "SUCCESS",
    })
    await expect(
      prisma.prototype.findUniqueOrThrow({
        select: { branchName: true, name: true },
        where: { id: fixture.prototypeId },
      }),
    ).resolves.toEqual({
      branchName: "feature/unchanged",
      name: "Unchanged prototype",
    })
  })

  it.each([
    {
      expectedReason: "expired",
      fixtureInput: { authorizationExpired: true },
      makeStale: async () => {},
      name: "authorization",
    },
    {
      expectedReason: "session_mismatch",
      fixtureInput: {},
      makeStale: async (fixture: Awaited<ReturnType<typeof createFixture>>) => {
        await prisma.hubSession.update({
          data: { endedAt: new Date() },
          where: { id: fixture.actorSessionId },
        })
      },
      name: "session",
    },
    {
      expectedReason: "not_authorized",
      fixtureInput: {},
      makeStale: async (fixture: Awaited<ReturnType<typeof createFixture>>) => {
        await prisma.membershipAssignment.update({
          data: { lifecycle: "REVOKED" },
          where: { id: fixture.actor.assignmentId },
        })
      },
      name: "administrator authority",
    },
  ])(
    "denies stale $name without partial mutation",
    async ({ expectedReason, fixtureInput, makeStale }) => {
      const fixture = await createFixture(fixtureInput)
      await makeStale(fixture)
      const before = await getSessionRevocationStatus(prisma)

      await expect(
        endAllHubSessions(prisma, {
          authorizationId: fixture.authorizationId,
          hubSessionId: fixture.actorSessionId,
        }),
      ).rejects.toMatchObject({ reason: expectedReason })

      await expect(getSessionRevocationStatus(prisma)).resolves.toEqual(before)
      await expect(
        prisma.sensitiveAuthorization.findUniqueOrThrow({
          select: { cancelledAt: true },
          where: { id: fixture.otherAuthorizationId },
        }),
      ).resolves.toEqual({ cancelledAt: null })
      await expect(
        prisma.sensitiveAuthorization.findUniqueOrThrow({
          select: { continuedAt: true },
          where: { id: fixture.authorizationId },
        }),
      ).resolves.toEqual({ continuedAt: null })
      await expect(
        prisma.hubSession.findUniqueOrThrow({
          select: { endedAt: true },
          where: { id: fixture.otherSessionId },
        }),
      ).resolves.toEqual({ endedAt: null })
      await expect(
        prisma.securityAudit.findMany({
          select: { action: true, context: true, outcome: true },
          where: {
            action:
              expectedReason === "expired"
                ? "session.revocation.authorization.expired"
                : "session.revocation.authorization.denied",
          },
        }),
      ).resolves.toEqual([
        {
          action:
            expectedReason === "expired"
              ? "session.revocation.authorization.expired"
              : "session.revocation.authorization.denied",
          context: {
            actorMembershipId: fixture.actor.membershipId,
            operation: "end_all_hub_sessions",
            phase: expectedReason === "expired" ? "expired" : "denied",
            reason: expectedReason,
            targetCount: 0,
          },
          outcome: "DENIED",
        },
      ])
      await expect(
        prisma.securityAudit.count({ where: { action: "session.revocation.end_all" } }),
      ).resolves.toBe(0)
    },
  )

  it("writes focused failure evidence after session termination rolls back", async () => {
    const fixture = await createFixture()
    const before = await getSessionRevocationStatus(prisma)
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_session_revocation_termination()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'session termination unavailable';
      END;
      $$ LANGUAGE plpgsql
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_session_revocation_termination
      BEFORE UPDATE ON hub_sessions
      FOR EACH ROW EXECUTE FUNCTION fail_session_revocation_termination()
    `)
    try {
      await expect(
        endAllHubSessions(prisma, {
          authorizationId: fixture.authorizationId,
          hubSessionId: fixture.actorSessionId,
        }),
      ).rejects.toThrow()
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER fail_session_revocation_termination ON hub_sessions`,
      )
      await prisma.$executeRawUnsafe(`DROP FUNCTION fail_session_revocation_termination()`)
    }

    await expect(getSessionRevocationStatus(prisma)).resolves.toEqual(before)
    await expect(
      prisma.securityAudit.findMany({
        select: { action: true, context: true, outcome: true },
        where: { action: "session.revocation.end_all_failed" },
      }),
    ).resolves.toEqual([
      {
        action: "session.revocation.end_all_failed",
        context: {
          actorMembershipId: fixture.actor.membershipId,
          reason: "transaction_error",
        },
        outcome: "FAILURE",
      },
    ])
  })
})
