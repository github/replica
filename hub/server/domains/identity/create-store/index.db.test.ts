import { randomUUID } from "node:crypto"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createIdentityStore } from "#server/domains/identity/create-store"
import { consumeAuthorizationAttempt } from "#server/repositories/authorization-attempts/consume-attempt"

type IdentityStore = ReturnType<typeof createIdentityStore>

async function database() {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  return { prisma, store: createIdentityStore(prisma) }
}

async function createIdentityGraph(store: IdentityStore, suffix: string) {
  return store.lock(async (records) => {
    const user = await records.createUser({
      displayName: `Synthetic User ${suffix}`,
      avatarUrl: null,
    })
    const externalIdentity = await records.saveExternalIdentity({
      userId: user.id,
      provider: "oidc",
      issuer: `https://issuer-${suffix}.example`,
      subject: `subject-${suffix}`,
      username: `synthetic-${suffix}`,
      displayName: `Synthetic User ${suffix}`,
      avatarUrl: null,
    })
    const authenticationProviderRevision = await records.createAuthenticationProviderRevision({
      key: `oidc-${suffix}`,
      type: "oidc",
      enabled: true,
      revision: 1,
      issuer: `https://issuer-${suffix}.example`,
      configuration: {
        authorizationEndpoint: `https://issuer-${suffix}.example/authorize`,
        clientId: `client-${suffix}`,
      },
    })
    return { authenticationProviderRevision, externalIdentity, user }
  })
}

async function createSession(store: IdentityStore, suffix: string) {
  const graph = await createIdentityGraph(store, suffix)
  const session = await store.lock((records) =>
    records.createSession({
      userId: graph.user.id,
      externalIdentityId: graph.externalIdentity.id,
      authenticationProviderRevisionId: graph.authenticationProviderRevision.id,
      tokenDigest: `token-digest-${suffix}`,
      signedInAt: new Date(),
      freshAuthorizedAt: new Date(),
    }),
  )
  return { ...graph, session }
}

describe("createIdentityStore()", () => {
  it("exposes queries without exposing mutations outside the store lock", async () => {
    const { store } = await database()

    expect(Object.keys(store.read).sort()).toEqual([
      "audits",
      "externalIdentity",
      "githubIntegrationCredentials",
      "hasFreshGitHubAdmission",
      "identityStoreState",
      "invitations",
      "membership",
      "memberships",
      "session",
      "sessionById",
      "user",
    ])
  })

  it("pages every active membership and pending invitation without truncation", async () => {
    const { prisma, store } = await database()
    const users = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(),
      displayName: `Paged member ${index}`,
      avatarUrl: null,
    }))
    await prisma.user.createMany({ data: users })
    await prisma.installationMembership.createMany({
      data: users.map((user) => ({
        id: randomUUID(),
        userId: user.id,
        status: "active",
        role: "member",
        source: "manual",
        suspendedAt: null,
        removedAt: null,
      })),
    })
    await prisma.membershipInvitation.createMany({
      data: users.map((_, index) => ({
        id: randomUUID(),
        createdByUserId: null,
        provider: "github",
        issuer: "https://github.com",
        subject: `paged-subject-${index}`,
        role: "member",
        expiresAt: new Date("2026-11-05T18:00:00.000Z"),
      })),
    })

    const membershipFirstPage = await store.read.memberships()
    const membershipSecondPage = await store.read.memberships(membershipFirstPage.nextCursor)
    expect(membershipFirstPage.memberships).toHaveLength(100)
    expect(membershipFirstPage.nextCursor).not.toBeNull()
    expect(membershipSecondPage).toMatchObject({
      memberships: [expect.objectContaining({ status: "active" })],
      nextCursor: null,
    })
    expect(
      new Set([
        ...membershipFirstPage.memberships.map(({ id }) => id),
        ...membershipSecondPage.memberships.map(({ id }) => id),
      ]).size,
    ).toBe(101)

    const invitationFirstPage = await store.read.invitations()
    const invitationSecondPage = await store.read.invitations(invitationFirstPage.nextCursor)
    expect(invitationFirstPage.invitations).toHaveLength(100)
    expect(invitationFirstPage.nextCursor).not.toBeNull()
    expect(invitationSecondPage).toMatchObject({
      invitations: [
        expect.objectContaining({
          consumedAt: null,
          revokedAt: null,
        }),
      ],
      nextCursor: null,
    })
    expect(
      new Set([
        ...invitationFirstPage.invitations.map(({ id }) => id),
        ...invitationSecondPage.invitations.map(({ id }) => id),
      ]).size,
    ).toBe(101)
  })

  it("rolls back GitHub integration, session, and audit changes together", async () => {
    const { store } = await database()
    const { session } = await createSession(store, "rollback")
    await store.lock((records) =>
      records.saveGitHubIntegrationCredentials("initial-encrypted-fixture"),
    )

    await expect(
      store.lock(async (records) => {
        await records.saveGitHubIntegrationCredentials("replacement-encrypted-fixture")
        await records.deleteSessions()
        await expect(records.sessionById(session.id)).resolves.toBeNull()
        await records.audit({
          event: "session.revoke_all",
          actorUserId: null,
          sessionId: null,
          authenticationProviderRevisionId: null,
        })
        throw new Error("Transaction failed")
      }),
    ).rejects.toThrow("Transaction failed")

    expect(await store.read.githubIntegrationCredentials()).toMatchObject({
      encryptedCredentials: "initial-encrypted-fixture",
    })
    expect(await store.read.sessionById(session.id)).not.toBeNull()
    expect(await store.read.audits()).toEqual([])
  })

  it("blocks an overlapping mutation until it can read the committed credentials", async () => {
    const { prisma, store } = await database()
    await store.lock(() => Promise.resolve())
    let entered!: () => void
    let release!: () => void
    let secondEntered = false
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = store.lock(async (records) => {
      await records.saveGitHubIntegrationCredentials("first-encrypted-fixture")
      entered()
      await gate
    })
    await started
    const second = store.lock(async (records) => {
      secondEntered = true
      const credentials = await records.githubIntegrationCredentials()
      await records.saveGitHubIntegrationCredentials("second-encrypted-fixture")
      return credentials.encryptedCredentials
    })
    onTestFinished(() => {
      release()
    })

    try {
      await vi.waitFor(
        async () => {
          const [waiting] = await prisma.$queryRaw<{ waitEventType: string | null }[]>`
            SELECT wait_event_type AS "waitEventType"
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND state = 'active'
              AND query LIKE '%identity_store_states%'
              AND wait_event_type = 'Lock'
            LIMIT 1
          `
          expect(waiting?.waitEventType).toBe("Lock")
        },
        { interval: 20, timeout: 5_000 },
      )
      expect(secondEntered).toBe(false)
    } finally {
      release()
    }

    await first
    expect(await second).toBe("first-encrypted-fixture")
    expect(await store.read.githubIntegrationCredentials()).toMatchObject({
      encryptedCredentials: "second-encrypted-fixture",
    })
  })

  it("links multiple issuer-scoped external identities without allowing a relink", async () => {
    const { store } = await database()
    const firstUser = await store.lock((records) =>
      records.createUser({ displayName: "First user", avatarUrl: null }),
    )
    const secondUser = await store.lock((records) =>
      records.createUser({ displayName: "Second user", avatarUrl: null }),
    )
    const firstIdentity = await store.lock((records) =>
      records.saveExternalIdentity({
        userId: firstUser.id,
        provider: "oidc",
        issuer: "https://first.example",
        subject: "shared-subject",
        username: "first-name",
        displayName: "First identity",
        avatarUrl: null,
      }),
    )
    const secondIdentity = await store.lock((records) =>
      records.saveExternalIdentity({
        userId: firstUser.id,
        provider: "oidc",
        issuer: "https://second.example",
        subject: "shared-subject",
        username: "second-name",
        displayName: "Second identity",
        avatarUrl: null,
      }),
    )
    const relinkAttempt = await store.lock((records) =>
      records.saveExternalIdentity({
        userId: secondUser.id,
        provider: "oidc",
        issuer: "https://first.example",
        subject: "shared-subject",
        username: "updated-name",
        displayName: "Updated identity",
        avatarUrl: null,
      }),
    )

    expect(secondIdentity.id).not.toBe(firstIdentity.id)
    expect(secondIdentity.userId).toBe(firstUser.id)
    expect(relinkAttempt).toMatchObject({
      id: firstIdentity.id,
      userId: firstUser.id,
      username: "updated-name",
    })
    expect(
      await store.read.externalIdentity("oidc", "https://first.example", "shared-subject"),
    ).toMatchObject({ id: firstIdentity.id, user: { id: firstUser.id } })
    expect(await store.read.user(firstUser.id)).not.toHaveProperty("administrator")
  })

  it("persists installation status, role, and source independently from the user", async () => {
    const { store } = await database()
    const user = await store.lock((records) =>
      records.createUser({ displayName: "Administrator", avatarUrl: null }),
    )

    await store.lock((records) =>
      records.saveMembership({
        userId: user.id,
        status: "active",
        role: "administrator",
        source: "bootstrap",
        suspendedAt: null,
        removedAt: null,
      }),
    )
    const suspendedAt = new Date("2026-10-27T18:00:00.000Z")
    await store.lock((records) =>
      records.saveMembership({
        userId: user.id,
        status: "suspended",
        role: "member",
        source: "manual",
        suspendedAt,
        removedAt: null,
      }),
    )

    expect(await store.read.membership(user.id)).toMatchObject({
      userId: user.id,
      status: "suspended",
      role: "member",
      source: "manual",
      suspendedAt,
      removedAt: null,
    })
    expect(await store.read.user(user.id)).toEqual(user)
    expect(user).not.toHaveProperty("administrator")
  })

  it("stores OIDC provider revisions separately from GitHub integration credentials", async () => {
    const { prisma, store } = await database()
    const revision = await store.lock((records) =>
      records.createAuthenticationProviderRevision({
        key: "workforce-oidc",
        type: "oidc",
        enabled: true,
        revision: 7,
        issuer: "https://login.example",
        configuration: {
          authorizationEndpoint: "https://login.example/authorize",
          clientId: "replica-hub",
        },
      }),
    )

    expect(revision).toMatchObject({
      revision: 7,
      issuer: "https://login.example",
      configuration: {
        authorizationEndpoint: "https://login.example/authorize",
        clientId: "replica-hub",
      },
      authenticationProvider: {
        key: "workforce-oidc",
        type: "oidc",
        enabled: true,
      },
    })
    expect(await store.read.githubIntegrationCredentials()).toMatchObject({
      encryptedCredentials: null,
    })

    await expect(
      store.lock((records) =>
        records.createAuthenticationProviderRevision({
          key: "workforce-oidc",
          type: "oidc",
          enabled: true,
          revision: 7,
          issuer: "https://replacement.example",
          configuration: { clientId: "replacement-client" },
        }),
      ),
    ).rejects.toThrow()
    await store.lock((records) =>
      records.saveGitHubIntegrationCredentials("encrypted-github-credentials"),
    )

    expect(
      await prisma.authenticationProviderRevision.findUnique({ where: { id: revision.id } }),
    ).toMatchObject({
      issuer: "https://login.example",
      configuration: revision.configuration,
    })
  })

  it("keeps sessions tied to identity revisions when GitHub credentials rotate", async () => {
    const { store } = await database()
    const { authenticationProviderRevision, externalIdentity, session, user } = await createSession(
      store,
      "credential-rotation",
    )

    await store.lock((records) =>
      records.saveGitHubIntegrationCredentials("rotated-encrypted-credentials"),
    )

    expect(await store.read.session(session.tokenDigest)).toMatchObject({
      id: session.id,
      user: { id: user.id },
      externalIdentity: { id: externalIdentity.id },
      authenticationProviderRevision: {
        id: authenticationProviderRevision.id,
        authenticationProvider: { key: "oidc-credential-rotation", type: "oidc" },
      },
    })
  })

  it("rejects a session when the external identity provider type differs", async () => {
    const { store } = await database()
    const user = await store.lock((records) =>
      records.createUser({ displayName: "Provider mismatch", avatarUrl: null }),
    )
    const externalIdentity = await store.lock((records) =>
      records.saveExternalIdentity({
        userId: user.id,
        provider: "github",
        issuer: "https://login.example",
        subject: "provider-mismatch",
        username: "provider-mismatch",
        displayName: "Provider mismatch",
        avatarUrl: null,
      }),
    )
    const authenticationProviderRevision = await store.lock((records) =>
      records.createAuthenticationProviderRevision({
        key: "provider-mismatch",
        type: "oidc",
        enabled: true,
        revision: 1,
        issuer: "https://login.example",
        configuration: { clientId: "provider-mismatch" },
      }),
    )

    await expect(
      store.lock((records) =>
        records.createSession({
          userId: user.id,
          externalIdentityId: externalIdentity.id,
          authenticationProviderRevisionId: authenticationProviderRevision.id,
          tokenDigest: "provider-mismatch-token",
          signedInAt: new Date(),
          freshAuthorizedAt: new Date(),
        }),
      ),
    ).rejects.toThrow("Session external identity provider must match")
    expect(await store.read.session("provider-mismatch-token")).toBeNull()
  })

  it("rejects a session when the external identity issuer differs", async () => {
    const { store } = await database()
    const user = await store.lock((records) =>
      records.createUser({ displayName: "Issuer mismatch", avatarUrl: null }),
    )
    const externalIdentity = await store.lock((records) =>
      records.saveExternalIdentity({
        userId: user.id,
        provider: "oidc",
        issuer: "https://identity.example",
        subject: "issuer-mismatch",
        username: "issuer-mismatch",
        displayName: "Issuer mismatch",
        avatarUrl: null,
      }),
    )
    const authenticationProviderRevision = await store.lock((records) =>
      records.createAuthenticationProviderRevision({
        key: "issuer-mismatch",
        type: "oidc",
        enabled: true,
        revision: 1,
        issuer: "https://provider.example",
        configuration: { clientId: "issuer-mismatch" },
      }),
    )

    await expect(
      store.lock((records) =>
        records.createSession({
          userId: user.id,
          externalIdentityId: externalIdentity.id,
          authenticationProviderRevisionId: authenticationProviderRevision.id,
          tokenDigest: "issuer-mismatch-token",
          signedInAt: new Date(),
          freshAuthorizedAt: new Date(),
        }),
      ),
    ).rejects.toThrow("Session external identity issuer must match")
    expect(await store.read.session("issuer-mismatch-token")).toBeNull()
  })

  it("keeps a provider type and historical session context after rejecting a type change", async () => {
    const { store } = await database()
    const { authenticationProviderRevision, session } = await createSession(
      store,
      "immutable-provider-type",
    )

    await expect(
      store.lock((records) =>
        records.createAuthenticationProviderRevision({
          key: "oidc-immutable-provider-type",
          type: "github",
          enabled: false,
          revision: 2,
          issuer: "https://github.com",
          configuration: { clientId: "replacement-client" },
        }),
      ),
    ).rejects.toThrow("Authentication provider type cannot change")

    expect(await store.read.session(session.tokenDigest)).toMatchObject({
      authenticationProviderRevision: {
        id: authenticationProviderRevision.id,
        revision: 1,
        authenticationProvider: {
          key: "oidc-immutable-provider-type",
          type: "oidc",
          enabled: true,
        },
      },
    })
  })

  it("deletes an attempt expiring at the database transaction time without consuming it", async () => {
    const { prisma, store } = await database()
    const { authenticationProviderRevision } = await createIdentityGraph(store, "expiry-boundary")
    const stateDigest = "expiry-boundary-state"

    const consumed = await prisma.$transaction(async (database) => {
      const [clock] = await database.$queryRaw<{ now: Date }[]>`
        SELECT CURRENT_TIMESTAMP AS now
      `
      if (!clock) throw new Error("Expected the database transaction time")
      await database.authorizationAttempt.create({
        data: {
          authenticationProviderRevisionId: authenticationProviderRevision.id,
          originatingSessionId: null,
          stateDigest,
          browserDigest: "expiry-boundary-browser",
          pkceVerifier: "expiry-boundary-verifier",
          nonce: null,
          purpose: "sign-in",
          expiresAt: clock.now,
        },
      })
      return consumeAuthorizationAttempt(database, stateDigest)
    })

    expect(consumed).toBeNull()
    expect(await prisma.authorizationAttempt.findUnique({ where: { stateDigest } })).toBeNull()
  })

  it("rejects an attempt that expires while its consumer waits for the store lock", async () => {
    const { prisma, store } = await database()
    const { authenticationProviderRevision } = await createIdentityGraph(store, "waiting-expiry")
    const stateDigest = "waiting-expiry-state"
    await store.lock(() => Promise.resolve())
    let announceAttempt!: (expiresAt: Date) => void
    let releaseLock!: () => void
    const attemptCreated = new Promise<Date>((resolve) => {
      announceAttempt = resolve
    })
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const holder = store.lock(async (records) => {
      const expiresAt = new Date(Date.now() + 1_500)
      await records.createAuthorizationAttempt({
        authenticationProviderRevisionId: authenticationProviderRevision.id,
        originatingSessionId: null,
        stateDigest,
        browserDigest: "waiting-expiry-browser",
        pkceVerifier: "waiting-expiry-verifier",
        nonce: null,
        purpose: "sign-in",
        expiresAt,
      })
      announceAttempt(expiresAt)
      await lockGate
    })
    const expiresAt = await attemptCreated
    let consumerEntered = false
    const consumer = store.lock(async (records) => {
      consumerEntered = true
      return records.consumeAuthorizationAttempt(stateDigest)
    })
    onTestFinished(async () => {
      releaseLock()
      await Promise.allSettled([holder, consumer])
    })

    await vi.waitFor(
      async () => {
        const [waiting] = await prisma.$queryRaw<
          { transactionStartedAt: Date; waitEventType: string | null }[]
        >`
          SELECT
            xact_start AS "transactionStartedAt",
            wait_event_type AS "waitEventType"
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND state = 'active'
            AND query LIKE '%identity_store_states%'
            AND wait_event_type = 'Lock'
          ORDER BY xact_start DESC
          LIMIT 1
        `
        expect(waiting?.waitEventType).toBe("Lock")
        expect(waiting?.transactionStartedAt.getTime()).toBeLessThan(expiresAt.getTime())
      },
      { interval: 20, timeout: 5_000 },
    )
    await vi.waitFor(
      async () => {
        const [clock] = await prisma.$queryRaw<{ expired: boolean }[]>`
          SELECT clock_timestamp() >= ${expiresAt} AS expired
        `
        expect(clock?.expired).toBe(true)
      },
      { interval: 20, timeout: 5_000 },
    )
    expect(consumerEntered).toBe(false)
    releaseLock()

    await holder
    expect(await consumer).toBeNull()
    expect(await prisma.authorizationAttempt.findUnique({ where: { stateDigest } })).toBeNull()
  })

  it("prunes expired provider-aware attempts and atomically consumes a live attempt once", async () => {
    const { prisma, store } = await database()
    const { authenticationProviderRevision, session } = await createSession(store, "attempt")
    const otherProviderRevision = await store.lock((records) =>
      records.createAuthenticationProviderRevision({
        key: "other-oidc",
        type: "oidc",
        enabled: true,
        revision: 2,
        issuer: "https://other.example",
        configuration: { clientId: "other-client" },
      }),
    )
    const expired = {
      authenticationProviderRevisionId: otherProviderRevision.id,
      originatingSessionId: null,
      stateDigest: "expired-state-digest",
      browserDigest: "expired-browser-digest",
      pkceVerifier: "expired-pkce-verifier",
      nonce: null,
      purpose: "sign-in" as const,
      expiresAt: new Date(Date.now() - 1),
    }
    const live = {
      authenticationProviderRevisionId: authenticationProviderRevision.id,
      originatingSessionId: session.id,
      stateDigest: "live-state-digest",
      browserDigest: "live-browser-digest",
      pkceVerifier: "live-pkce-verifier",
      nonce: "live-oidc-nonce",
      purpose: "link-identity" as const,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    }
    await store.lock((records) => records.createAuthorizationAttempt(expired))
    await store.lock((records) => records.createAuthorizationAttempt(live))

    expect(
      await prisma.authorizationAttempt.findUnique({
        where: { stateDigest: expired.stateDigest },
      }),
    ).toBeNull()
    const results = await Promise.all([
      prisma.$transaction((database) => consumeAuthorizationAttempt(database, live.stateDigest)),
      prisma.$transaction((database) => consumeAuthorizationAttempt(database, live.stateDigest)),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.find(Boolean)).toMatchObject(live)
    expect(
      await prisma.authorizationAttempt.findUnique({
        where: { stateDigest: live.stateDigest },
      }),
    ).toBeNull()
  })

  it("removes pending attempts with their originating session", async () => {
    const { store } = await database()
    const { authenticationProviderRevision, session } = await createSession(store, "sign-out")
    const attempt = {
      authenticationProviderRevisionId: authenticationProviderRevision.id,
      originatingSessionId: session.id,
      stateDigest: "originating-session-state",
      browserDigest: "originating-session-browser",
      pkceVerifier: "originating-session-verifier",
      nonce: null,
      purpose: "verify" as const,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    }
    await store.lock((records) => records.createAuthorizationAttempt(attempt))

    await store.lock((records) => records.invalidateFreshness())
    expect(await store.read.sessionById(session.id)).toMatchObject({ freshAuthorizedAt: null })
    await store.lock((records) => records.deleteSession(session.id))

    expect(await store.read.session(session.tokenDigest)).toBeNull()
    expect(
      await store.lock((records) => records.consumeAuthorizationAttempt(attempt.stateDigest)),
    ).toBeNull()
  })

  it("retains minimal structured audits for ninety days and prunes older records on writes", async () => {
    const { prisma, store } = await database()
    const { authenticationProviderRevision, session, user } = await createSession(store, "audit")
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now)
    const cutoff = now - 90 * 24 * 60 * 60_000
    const old = await prisma.securityAudit.create({
      data: {
        event: "identity.denied.request_failed",
        createdAt: new Date(cutoff - 1),
      },
    })
    const retained = await prisma.securityAudit.create({
      data: {
        event: "session.sign_in",
        createdAt: new Date(cutoff),
      },
    })

    expect((await store.read.audits()).map(({ id }) => id)).toEqual([retained.id])
    expect(await prisma.securityAudit.findUnique({ where: { id: old.id } })).not.toBeNull()
    await store.lock((records) =>
      records.audit({
        event: "identity.verified",
        actorUserId: user.id,
        sessionId: session.id,
        authenticationProviderRevisionId: authenticationProviderRevision.id,
      }),
    )

    expect(await prisma.securityAudit.findUnique({ where: { id: old.id } })).toBeNull()
    expect(await prisma.securityAudit.findUnique({ where: { id: retained.id } })).not.toBeNull()
    expect(await store.read.audits()).toEqual([
      expect.objectContaining({
        event: "identity.verified",
        actorUserId: user.id,
        sessionId: session.id,
        authenticationProviderRevisionId: authenticationProviderRevision.id,
      }),
      expect.objectContaining({ id: retained.id, event: "session.sign_in" }),
    ])
    expect(await prisma.securityAudit.count()).toBe(2)
  })
})
