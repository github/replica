import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createAuthenticationService } from "#server/domains/authentication/create-service"
import { createIdentityStore } from "#server/domains/identity/create-store"
import type { GitHubUserAuthClient } from "#server/integrations/github/create-user-auth-client/types"
import { digestSecret } from "#server/utils/digest-secret"

type IdentityStore = ReturnType<typeof createIdentityStore>

const githubConfiguration = {
  clientId: "github-client",
  clientSecret: "github-client-secret-fixture",
  callbackUrl: "https://hub.example/api/auth/github/callback",
  issuer: "https://github.com" as const,
}

async function database() {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  return { prisma, store: createIdentityStore(prisma) }
}

async function createAdministrator(store: IdentityStore) {
  return store.lock(async (records) => {
    const user = await records.createUser({
      displayName: "Synthetic administrator",
      avatarUrl: null,
    })
    const identity = await records.saveExternalIdentity({
      userId: user.id,
      provider: "github",
      issuer: "https://github.com",
      subject: "42",
      username: "octocat",
      displayName: "Synthetic administrator",
      avatarUrl: null,
    })
    const provider = await records.createAuthenticationProviderRevision({
      key: "github",
      type: "github",
      enabled: true,
      revision: 1,
      issuer: "https://github.com",
      configuration: { clientId: "github-client" },
    })
    await records.saveMembership({
      userId: user.id,
      status: "active",
      role: "administrator",
      source: "manual",
      suspendedAt: null,
      removedAt: null,
    })
    return { identity, provider, user }
  })
}

async function createSession(
  store: IdentityStore,
  graph: Awaited<ReturnType<typeof createAdministrator>>,
  token: string,
) {
  const authorizedAt = new Date()
  return store.lock((records) =>
    records.createSession({
      userId: graph.user.id,
      externalIdentityId: graph.identity.id,
      authenticationProviderRevisionId: graph.provider.id,
      tokenDigest: digestSecret(token),
      signedInAt: authorizedAt,
      freshAuthorizedAt: authorizedAt,
    }),
  )
}

function createGitHubService(
  store: IdentityStore,
  providerRevisionId: string,
  github: GitHubUserAuthClient,
  options: { bootstrapSecret?: string | null; recoverySecret?: string | null } = {},
) {
  return createAuthenticationService({
    store,
    github,
    configuration: githubConfiguration,
    providerRevisionId,
    admissionPolicy: { name: "hub-managed", admit: () => Promise.resolve(false) },
    ...options,
  })
}

describe("createAuthenticationService() database behavior", () => {
  it.each(["bootstrap", "recovery"] as const)(
    "consumes a real %s attempt and completes administrator enrollment",
    async (purpose) => {
      const { store } = await database()
      const provider = await store.lock((records) =>
        records.createAuthenticationProviderRevision({
          key: "github",
          type: "github",
          enabled: true,
          revision: 1,
          issuer: "https://github.com",
          configuration: { clientId: "github-client" },
        }),
      )
      const github: GitHubUserAuthClient = {
        authorizationUrl: (state) => `https://github.example/authorize?state=${state}`,
        identify: vi.fn().mockResolvedValue({
          subject: `enrolled-${purpose}`,
          username: `enrolled-${purpose}`,
          displayName: `Enrolled ${purpose}`,
          avatarUrl: null,
        }),
      }
      const secret = `${purpose}-secret`
      const now = new Date()
      const service = createAuthenticationService({
        store,
        github,
        configuration: githubConfiguration,
        providerRevisionId: provider.id,
        admissionPolicy: { name: "hub-managed", admit: () => Promise.resolve(false) },
        bootstrapSecret: purpose === "bootstrap" ? secret : null,
        recoverySecret: purpose === "recovery" ? secret : null,
        now: () => now,
      })

      const started = await service.start(purpose, undefined, secret)
      const state = new URL(started.authorizationUrl).searchParams.get("state")
      expect(state).toBeTruthy()

      const completed = await service.complete("one-use-code", state!, started.browserToken)

      expect(completed.purpose).toBe(purpose)
      expect(typeof completed.sessionToken).toBe("string")
      const identity = await store.read.externalIdentity(
        "github",
        "https://github.com",
        `enrolled-${purpose}`,
      )
      expect(identity).not.toBeNull()
      expect(await store.read.membership(identity!.userId)).toMatchObject({
        status: "active",
        role: "administrator",
        source: purpose,
      })
      expect(await store.read.session(digestSecret(completed.sessionToken!))).toMatchObject({
        userId: identity!.userId,
      })
    },
  )

  it("keeps bootstrap completion durable across inactive administrators and service recreation", async () => {
    const { prisma, store } = await database()
    const provider = await store.lock((records) =>
      records.createAuthenticationProviderRevision({
        key: "github",
        type: "github",
        enabled: true,
        revision: 1,
        issuer: "https://github.com",
        configuration: { clientId: "github-client" },
      }),
    )
    const identify = vi
      .fn()
      .mockResolvedValueOnce({
        subject: "first-bootstrap",
        username: "first-bootstrap",
        displayName: "First bootstrap",
        avatarUrl: null,
      })
      .mockResolvedValueOnce({
        subject: "second-bootstrap",
        username: "second-bootstrap",
        displayName: "Second bootstrap",
        avatarUrl: null,
      })
    const github: GitHubUserAuthClient = {
      authorizationUrl: (state) => `https://github.example/authorize?state=${state}`,
      identify,
    }
    const service = createGitHubService(store, provider.id, github, {
      bootstrapSecret: "bootstrap-secret",
    })
    const first = await service.start("bootstrap", undefined, "bootstrap-secret")
    const second = await service.start("bootstrap", undefined, "bootstrap-secret")
    const firstState = new URL(first.authorizationUrl).searchParams.get("state")
    const secondState = new URL(second.authorizationUrl).searchParams.get("state")
    const completed = await service.complete("first-code", firstState!, first.browserToken)
    const firstIdentity = await store.read.externalIdentity(
      "github",
      "https://github.com",
      "first-bootstrap",
    )
    expect(firstIdentity).not.toBeNull()
    await store.lock(async (records) => {
      const membership = await records.membership(firstIdentity!.userId)
      await records.saveMembership({
        userId: firstIdentity!.userId,
        status: "suspended",
        role: "administrator",
        source: membership!.source,
        suspendedAt: new Date(),
        removedAt: null,
      })
      await records.deleteUserSessions(firstIdentity!.userId)
    })

    await expect(
      service.complete("second-code", secondState!, second.browserToken),
    ).rejects.toMatchObject({ code: "admission_denied" })
    await prisma.authorizationAttempt.deleteMany()

    const recreated = createGitHubService(store, provider.id, github, {
      bootstrapSecret: "bootstrap-secret",
    })
    await expect(recreated.start("bootstrap", undefined, "bootstrap-secret")).rejects.toMatchObject(
      { code: "bootstrap_unavailable" },
    )
    expect(await prisma.user.count()).toBe(1)
    expect(await prisma.installationMembership.count()).toBe(1)
    expect(await prisma.session.count()).toBe(0)
    expect(await prisma.authorizationAttempt.count()).toBe(0)
    expect(completed.sessionToken).toBeDefined()
  })

  it("activates a usable invitation once, links it, and creates the invited session", async () => {
    const { prisma, store } = await database()
    const provider = await store.lock((records) =>
      records.createAuthenticationProviderRevision({
        key: "github",
        type: "github",
        enabled: true,
        revision: 1,
        issuer: "https://github.com",
        configuration: { clientId: "github-client" },
      }),
    )
    const now = new Date()
    const invitation = await store.lock((records) =>
      records.createInvitation({
        createdByUserId: null,
        provider: "github",
        issuer: "https://github.com",
        subject: "invited-user",
        role: "administrator",
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    )
    const github: GitHubUserAuthClient = {
      authorizationUrl: (state) => `https://github.example/authorize?state=${state}`,
      identify: vi.fn().mockResolvedValue({
        subject: "invited-user",
        username: "invited-user",
        displayName: "Invited user",
        avatarUrl: null,
      }),
    }
    const service = createGitHubService(store, provider.id, github)
    const started = await service.start("sign-in")
    const state = new URL(started.authorizationUrl).searchParams.get("state")

    const completed = await service.complete("code", state!, started.browserToken)

    const savedInvitation = await prisma.membershipInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    })
    expect(savedInvitation).toMatchObject({
      revokedAt: null,
    })
    expect(savedInvitation.consumedAt).toBeInstanceOf(Date)
    expect(typeof savedInvitation.activatedIdentityId).toBe("string")
    expect(typeof savedInvitation.activatedMembershipId).toBe("string")
    expect(
      await prisma.installationMembership.findUniqueOrThrow({
        where: { id: savedInvitation.activatedMembershipId! },
      }),
    ).toMatchObject({
      status: "active",
      role: "administrator",
      source: "invitation",
    })
    expect(await store.read.session(digestSecret(completed.sessionToken!))).not.toBeNull()
  })

  it("does not reuse a consumed invitation after its membership is removed", async () => {
    const { prisma, store } = await database()
    const provider = await store.lock((records) =>
      records.createAuthenticationProviderRevision({
        key: "github",
        type: "github",
        enabled: true,
        revision: 1,
        issuer: "https://github.com",
        configuration: { clientId: "github-client" },
      }),
    )
    await store.lock((records) =>
      records.createInvitation({
        createdByUserId: null,
        provider: "github",
        issuer: "https://github.com",
        subject: "consumed-user",
        role: "member",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )
    const github: GitHubUserAuthClient = {
      authorizationUrl: (state) => `https://github.example/authorize?state=${state}`,
      identify: vi.fn().mockResolvedValue({
        subject: "consumed-user",
        username: "consumed-user",
        displayName: null,
        avatarUrl: null,
      }),
    }
    const service = createGitHubService(store, provider.id, github)
    const first = await service.start("sign-in")
    await service.complete(
      "first-code",
      new URL(first.authorizationUrl).searchParams.get("state")!,
      first.browserToken,
    )
    const identity = await store.read.externalIdentity(
      "github",
      "https://github.com",
      "consumed-user",
    )
    expect(identity).not.toBeNull()
    await store.lock(async (records) => {
      const membership = await records.membership(identity!.userId)
      await records.saveMembership({
        userId: identity!.userId,
        status: "removed",
        role: membership!.role,
        source: membership!.source,
        suspendedAt: null,
        removedAt: new Date(),
      })
      await records.deleteUserSessions(identity!.userId)
    })
    const second = await service.start("sign-in")

    await expect(
      service.complete(
        "second-code",
        new URL(second.authorizationUrl).searchParams.get("state")!,
        second.browserToken,
      ),
    ).rejects.toMatchObject({ code: "admission_denied" })
    expect(await prisma.session.count()).toBe(0)
    expect(
      await prisma.installationMembership.findUniqueOrThrow({
        where: { userId: identity!.userId },
      }),
    ).toMatchObject({ status: "removed" })
  })

  it.each(["revoked", "expired"] as const)(
    "does not admit an identity through a %s invitation",
    async (boundary) => {
      const { prisma, store } = await database()
      const provider = await store.lock((records) =>
        records.createAuthenticationProviderRevision({
          key: "github",
          type: "github",
          enabled: true,
          revision: 1,
          issuer: "https://github.com",
          configuration: { clientId: "github-client" },
        }),
      )
      const now = new Date()
      const invitation = await store.lock((records) =>
        records.createInvitation({
          createdByUserId: null,
          provider: "github",
          issuer: "https://github.com",
          subject: `unusable-${boundary}`,
          role: "member",
          expiresAt:
            boundary === "expired" ? new Date(now.getTime() - 1) : new Date(now.getTime() + 60_000),
        }),
      )
      if (boundary === "revoked") {
        await prisma.membershipInvitation.update({
          where: { id: invitation.id },
          data: { revokedAt: now },
        })
      }
      const github: GitHubUserAuthClient = {
        authorizationUrl: (state) => `https://github.example/authorize?state=${state}`,
        identify: vi.fn().mockResolvedValue({
          subject: `unusable-${boundary}`,
          username: `unusable-${boundary}`,
          displayName: null,
          avatarUrl: null,
        }),
      }
      const service = createGitHubService(store, provider.id, github)
      const started = await service.start("sign-in")
      const state = new URL(started.authorizationUrl).searchParams.get("state")

      await expect(service.complete("code", state!, started.browserToken)).rejects.toMatchObject({
        code: "admission_denied",
      })
      expect(await prisma.user.count()).toBe(0)
      expect(await prisma.installationMembership.count()).toBe(0)
      expect(await prisma.session.count()).toBe(0)
    },
  )

  it("commits an admission-policy failure audit before returning the provider error", async () => {
    const { prisma, store } = await database()
    const graph = await createAdministrator(store)
    const now = new Date()
    await prisma.installationMembership.update({
      where: { userId: graph.user.id },
      data: { role: "member", source: "synchronized" },
    })
    await store.lock((records) =>
      records.createAuthorizationAttempt({
        authenticationProviderRevisionId: graph.provider.id,
        originatingSessionId: null,
        stateDigest: digestSecret("state"),
        browserDigest: digestSecret("browser-token"),
        pkceVerifier: "pkce-verifier",
        nonce: null,
        purpose: "sign-in",
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    )
    const service = createAuthenticationService({
      store,
      github: {
        authorizationUrl: vi.fn(),
        identify: vi.fn().mockResolvedValue({
          subject: graph.identity.subject,
          username: "octocat",
          displayName: "Synthetic administrator",
          avatarUrl: null,
        }),
      },
      configuration: {
        clientId: "github-client",
        clientSecret: "github-client-secret-fixture",
        callbackUrl: "https://hub.example/api/auth/github/callback",
        issuer: "https://github.com",
      },
      providerRevisionId: graph.provider.id,
      admissionPolicy: {
        name: "github-synchronized",
        admit: vi.fn().mockRejectedValue(
          Object.assign(new Error("GitHub authorization changed."), {
            status: 409,
            code: "github_authorization_changed",
          }),
        ),
      },
      now: () => now,
    })

    await expect(service.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 503,
      code: "source_integration_unavailable",
    })
    expect(
      await prisma.securityAudit.findFirst({
        where: { event: "authentication.admission_failed" },
      }),
    ).toMatchObject({
      outcome: "failed",
      actorUserId: graph.user.id,
      authenticationProviderRevisionId: graph.provider.id,
      context: { reason: "source_integration_unavailable" },
    })
    expect(await prisma.session.count({ where: { userId: graph.user.id } })).toBe(0)
  })

  it("rolls back generation, session deletion, and audit together when revocation fails", async () => {
    const { store } = await database()
    const graph = await createAdministrator(store)
    const session = await createSession(store, graph, "rollback-token")

    await expect(
      store.lock(async (records) => {
        await records.advanceSessionGeneration()
        await records.deleteSessions()
        await records.audit({
          event: "session.revoke_all",
          actorUserId: graph.user.id,
          sessionId: session.id,
          authenticationProviderRevisionId: graph.provider.id,
        })
        throw new Error("revocation failed")
      }),
    ).rejects.toThrow("revocation failed")

    expect(await store.read.identityStoreState()).toEqual({ sessionGeneration: 0 })
    expect(await store.read.session(digestSecret("rollback-token"))).toMatchObject({
      id: session.id,
    })
    expect(await store.read.audits()).toEqual([])
  })

  it("serializes concurrent revoke-all requests so generation advances exactly once", async () => {
    const { store } = await database()
    const graph = await createAdministrator(store)
    await createSession(store, graph, "administrator-token")
    await createSession(store, graph, "other-token")
    const service = createAuthenticationService({
      store,
      github: null,
      configuration: null,
      providerRevisionId: null,
      admissionPolicy: { name: "hub-managed", admit: () => Promise.resolve("legacy") },
    })

    const results = await Promise.allSettled([
      service.revokeAll("administrator-token"),
      service.revokeAll("administrator-token"),
    ])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1)
    expect(await store.read.identityStoreState()).toEqual({ sessionGeneration: 1 })
    expect(await store.read.session(digestSecret("administrator-token"))).toBeNull()
    expect(await store.read.session(digestSecret("other-token"))).toBeNull()
    expect(await store.read.audits()).toEqual([
      expect.objectContaining({
        event: "session.revoke_all",
        actorUserId: graph.user.id,
      }),
    ])
  })
})
