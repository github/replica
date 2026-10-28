import { describe, expect, it, vi } from "vitest"
import type { Mocked } from "vitest"

import { createAuthenticationService } from "#server/domains/authentication/create-service"
import type { AuthenticationDependencies } from "#server/domains/authentication/create-service/types"
import type { IdentityRecords, IdentityStore } from "#server/domains/identity/create-store/types"
import type { GitHubUserAuthClient } from "#server/integrations/github/create-user-auth-client/types"
import { digestSecret } from "#server/utils/digest-secret"

const now = new Date("2026-10-27T18:00:00.000Z")
const configuration = {
  clientId: "github-client",
  clientSecret: "github-client-secret-fixture",
  callbackUrl: "https://hub.example/api/auth/github/callback",
  issuer: "https://github.com" as const,
}
const providerRevision = {
  id: "provider-revision",
  authenticationProviderId: "provider",
  revision: 1,
  issuer: configuration.issuer,
  configuration: {},
  authenticationProvider: {
    id: "provider",
    key: "github",
    type: "github",
    enabled: true,
  },
}

type MockIdentityRecords = Mocked<IdentityRecords>

function records(overrides: Partial<MockIdentityRecords> = {}) {
  const fixture = {
    currentAuthenticationProviderRevision: vi.fn().mockResolvedValue(providerRevision),
    identityStoreState: vi.fn().mockResolvedValue({ sessionGeneration: 3 }),
    createAuthorizationAttempt: vi.fn().mockResolvedValue(undefined),
    consumeAuthorizationAttempt: vi.fn().mockResolvedValue(null),
    externalIdentity: vi.fn().mockResolvedValue(null),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    saveExternalIdentity: vi.fn(),
    createSession: vi.fn(),
    verifySession: vi.fn(),
    deleteSession: vi.fn(),
    deleteSessions: vi.fn(),
    advanceSessionGeneration: vi.fn(),
    session: vi.fn().mockResolvedValue(null),
    sessionById: vi.fn().mockResolvedValue(null),
    membership: vi.fn().mockResolvedValue(null),
    usableInvitation: vi.fn().mockResolvedValue(null),
    consumeInvitation: vi.fn().mockResolvedValue(true),
    bootstrapCompletedAt: vi.fn().mockResolvedValue(null),
    activeAdministratorCount: vi.fn().mockResolvedValue(0),
    completeBootstrap: vi.fn().mockResolvedValue(true),
    saveMembership: vi.fn().mockResolvedValue({
      id: "membership",
      userId: "user",
      status: "active",
      role: "member",
      source: "synchronized",
      suspendedAt: null,
      removedAt: null,
    }),
    audit: vi.fn(),
  }
  return Object.assign(fixture, overrides)
}

type TestIdentityRecords = ReturnType<typeof records>

function store(identityRecords: TestIdentityRecords): IdentityStore {
  const typedRecords = identityRecords as unknown as IdentityRecords
  return {
    read: typedRecords,
    lock: (operation) => operation(typedRecords, {} as never),
  }
}

function dependencies(
  identityRecords: TestIdentityRecords,
  overrides: Partial<
    Pick<AuthenticationDependencies, "admissionPolicy" | "configuration" | "providerRevisionId">
  > = {},
) {
  const github: Mocked<GitHubUserAuthClient> = {
    authorizationUrl: vi.fn(
      (state, verifier) => `https://github.example/authorize?state=${state}&verifier=${verifier}`,
    ),
    identify: vi.fn(),
  }
  return {
    store: store(identityRecords),
    github,
    configuration,
    providerRevisionId: providerRevision.id,
    admissionPolicy: {
      name: "hub-managed" as const,
      admit: vi.fn().mockResolvedValue(true),
    },
    now: () => now,
    ...overrides,
  }
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt",
    authenticationProviderRevisionId: providerRevision.id,
    originatingSessionId: null,
    stateDigest: digestSecret("state"),
    browserDigest: digestSecret("browser-token"),
    pkceVerifier: "pkce-verifier",
    nonce: null,
    purpose: "sign-in" as const,
    sessionGeneration: 3,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  }
}

describe("createAuthenticationService()", () => {
  it("starts a short-lived browser-bound authorization with state and an S256-ready verifier", async () => {
    const identityRecords = records()
    const options = dependencies(identityRecords, {
      admissionPolicy: {
        name: "hub-managed",
        admit: vi.fn().mockResolvedValue(false),
      },
    })
    const service = createAuthenticationService(options)

    const result = await service.start("sign-in")

    const authorizationUrl = new URL(result.authorizationUrl)
    const state = authorizationUrl.searchParams.get("state")
    const verifier = authorizationUrl.searchParams.get("verifier")
    expect(state).toMatch(/^[\w-]{43}$/)
    expect(result.browserToken).toMatch(/^[\w-]{43}$/)
    expect(verifier).toMatch(/^[\w-]{43}$/)
    expect(identityRecords.createAuthorizationAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        stateDigest: digestSecret(state!),
        browserDigest: digestSecret(result.browserToken),
        pkceVerifier: verifier,
        purpose: "sign-in",
        sessionGeneration: 3,
        expiresAt: new Date(now.getTime() + 10 * 60_000),
      }),
    )
    expect(identityRecords.createAuthorizationAttempt).not.toHaveBeenCalledWith(
      expect.objectContaining({ stateDigest: state, browserDigest: result.browserToken }),
    )
  })

  it("consumes an attempt before rejecting the wrong browser so neither replay can exchange a code", async () => {
    let available = attempt()
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn(() => {
        const consumed = available
        available = null as never
        return Promise.resolve(consumed)
      }),
    })
    const options = dependencies(identityRecords)
    const service = createAuthenticationService(options)

    await expect(service.complete("code", "state", "wrong-browser")).rejects.toMatchObject({
      status: 401,
      code: "invalid_authorization",
    })
    await expect(service.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 401,
      code: "invalid_authorization",
    })
    expect(options.github.identify.mock.calls).toHaveLength(0)
  })

  it("fails closed when the store reports an expired or unknown authorization attempt", async () => {
    const identityRecords = records()
    const options = dependencies(identityRecords)
    const service = createAuthenticationService(options)

    await expect(service.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 401,
      code: "invalid_authorization",
    })
    expect(options.github.identify.mock.calls).toHaveLength(0)
  })

  it("updates the existing immutable GitHub identity and creates a session without repository data", async () => {
    const existingIdentity = {
      id: "identity",
      userId: "user",
      provider: "github",
      issuer: configuration.issuer,
      subject: "42",
      username: "old-login",
      displayName: "Old name",
      avatarUrl: null,
      user: { id: "user", displayName: "Old name", avatarUrl: null },
    }
    const updatedIdentity = {
      ...existingIdentity,
      username: "new-login",
      displayName: "New name",
      avatarUrl: "https://avatars.example/42",
    }
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      externalIdentity: vi.fn().mockResolvedValue(existingIdentity),
      updateUser: vi.fn().mockResolvedValue(updatedIdentity.user),
      saveExternalIdentity: vi.fn().mockResolvedValue(updatedIdentity),
      createSession: vi.fn().mockResolvedValue({
        id: "session",
        userId: "user",
        externalIdentityId: "identity",
        authenticationProviderRevisionId: providerRevision.id,
        tokenDigest: "stored-digest",
        signedInAt: now,
        freshAuthorizedAt: now,
      }),
    })

    const options = dependencies(identityRecords)
    options.github.identify.mockResolvedValue({
      subject: "42",
      username: "new-login",
      displayName: "New name",
      avatarUrl: "https://avatars.example/42",
    })
    const service = createAuthenticationService(options)

    const result = await service.complete("one-use-code", "state", "browser-token")

    expect(identityRecords.createUser).not.toHaveBeenCalled()
    expect(identityRecords.saveExternalIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user", subject: "42", username: "new-login" }),
    )
    expect(identityRecords.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user",
        externalIdentityId: "identity",
        tokenDigest: digestSecret(result.sessionToken!),
      }),
    )
    expect(JSON.stringify(vi.mocked(identityRecords.createSession).mock.calls)).not.toContain(
      "one-use-code",
    )
  })

  it("uses an exact invitation before a qualifying synchronized baseline for an inactive identity", async () => {
    const existingIdentity = {
      id: "identity",
      userId: "user",
      provider: "github",
      issuer: configuration.issuer,
      subject: "42",
      username: "octocat",
      displayName: "Octocat",
      avatarUrl: null,
      user: { id: "user", displayName: "Octocat", avatarUrl: null },
    }
    const invitation = {
      id: "invitation",
      createdByUserId: "administrator",
      activatedIdentityId: null,
      activatedMembershipId: null,
      provider: "github",
      issuer: configuration.issuer,
      subject: "42",
      role: "administrator" as const,
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
      revokedAt: null,
      createdAt: now,
    }
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      externalIdentity: vi.fn().mockResolvedValue(existingIdentity),
      usableInvitation: vi.fn().mockResolvedValue(invitation),
      updateUser: vi.fn().mockResolvedValue(existingIdentity.user),
      saveExternalIdentity: vi.fn().mockResolvedValue(existingIdentity),
      saveMembership: vi.fn().mockResolvedValue({
        id: "membership",
        userId: "user",
        status: "active",
        role: "administrator",
        source: "invitation",
        suspendedAt: null,
        removedAt: null,
      }),
      createSession: vi.fn().mockResolvedValue({
        id: "session",
        userId: "user",
        externalIdentityId: "identity",
        authenticationProviderRevisionId: providerRevision.id,
        tokenDigest: "stored-digest",
        signedInAt: now,
        freshAuthorizedAt: now,
      }),
    })
    const saveBaseline = vi.fn()
    const options = dependencies(identityRecords, {
      admissionPolicy: {
        name: "github-synchronized",
        admit: vi.fn().mockResolvedValue({
          repositorySourceId: "00000000-0000-0000-0000-000000000001",
          sourceGeneration: 3,
          rawPermission: "write",
          admissionEligible: true,
          prototypeRole: "editor",
          confirmedAt: now,
        }),
        saveBaseline,
      },
    })
    options.github.identify.mockResolvedValue({
      subject: "42",
      username: "octocat",
      displayName: "Octocat",
      avatarUrl: null,
    })

    const result = await createAuthenticationService(options).complete(
      "code",
      "state",
      "browser-token",
    )
    expect(result.purpose).toBe("sign-in")
    expect(typeof result.sessionToken).toBe("string")

    expect(identityRecords.usableInvitation).toHaveBeenCalledWith(
      "github",
      configuration.issuer,
      "42",
      now,
    )
    expect(identityRecords.consumeInvitation).toHaveBeenCalledWith(
      "invitation",
      "identity",
      "membership",
      now,
    )
    expect(identityRecords.saveMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user",
        role: "administrator",
        source: "invitation",
      }),
    )
    expect(saveBaseline).toHaveBeenCalledWith(expect.anything(), "user", expect.any(Object))
  })

  it("uses an invitation before a qualifying synchronized baseline for a new identity", async () => {
    const invitation = {
      id: "invitation",
      createdByUserId: "administrator",
      activatedIdentityId: null,
      activatedMembershipId: null,
      provider: "github",
      issuer: configuration.issuer,
      subject: "42",
      role: "administrator" as const,
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
      revokedAt: null,
      createdAt: now,
    }
    const identity = {
      id: "identity",
      userId: "user",
      provider: "github",
      issuer: configuration.issuer,
      subject: "42",
      username: "octocat",
      displayName: "Octocat",
      avatarUrl: null,
      user: { id: "user", displayName: "Octocat", avatarUrl: null },
    }
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      usableInvitation: vi.fn().mockResolvedValue(invitation),
      createUser: vi.fn().mockResolvedValue(identity.user),
      saveExternalIdentity: vi.fn().mockResolvedValue(identity),
      createSession: vi.fn().mockResolvedValue({
        id: "session",
        userId: "user",
        externalIdentityId: "identity",
        authenticationProviderRevisionId: providerRevision.id,
        tokenDigest: "stored-digest",
        signedInAt: now,
        freshAuthorizedAt: now,
      }),
    })
    const saveBaseline = vi.fn()
    const options = dependencies(identityRecords, {
      admissionPolicy: {
        name: "github-synchronized",
        admit: vi.fn().mockResolvedValue({
          repositorySourceId: "00000000-0000-0000-0000-000000000001",
          sourceGeneration: 3,
          rawPermission: "read",
          admissionEligible: true,
          prototypeRole: "viewer",
          confirmedAt: now,
        }),
        saveBaseline,
      },
    })
    options.github.identify.mockResolvedValue({
      subject: "42",
      username: "octocat",
      displayName: "Octocat",
      avatarUrl: null,
    })

    await expect(
      createAuthenticationService(options).complete("code", "state", "browser-token"),
    ).resolves.toMatchObject({ purpose: "sign-in" })

    expect(identityRecords.saveMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user",
        role: "administrator",
        source: "invitation",
      }),
    )
    expect(identityRecords.consumeInvitation).toHaveBeenCalledWith(
      "invitation",
      "identity",
      "membership",
      now,
    )
    expect(saveBaseline).toHaveBeenCalledWith(expect.anything(), "user", expect.any(Object))
  })

  it("binds bootstrap enrollment to the configured one-use secret", async () => {
    const identityRecords = records()
    const service = createAuthenticationService({
      ...dependencies(identityRecords),
      bootstrapSecret: "bootstrap-secret",
    })

    await expect(service.start("bootstrap", undefined, "wrong-secret")).rejects.toMatchObject({
      status: 404,
      code: "bootstrap_unavailable",
    })
    expect(identityRecords.audit).toHaveBeenCalledWith({
      event: "membership.bootstrap",
      outcome: "denied",
      actorUserId: null,
      sessionId: null,
      authenticationProviderRevisionId: providerRevision.id,
      context: { reason: "secret_mismatch" },
    })
    const result = await service.start("bootstrap", undefined, "bootstrap-secret")
    expect(result.authorizationUrl).toContain("state=")
    expect(typeof result.browserToken).toBe("string")
    const [createdAttempt] = identityRecords.createAuthorizationAttempt.mock.calls[0]!
    expect(createdAttempt.purpose).toBe("bootstrap")
  })

  it("keeps recovery separate and unavailable while an active administrator remains", async () => {
    const identityRecords = records({
      activeAdministratorCount: vi.fn().mockResolvedValue(1),
    })
    const service = createAuthenticationService({
      ...dependencies(identityRecords),
      recoverySecret: "recovery-secret",
    })

    await expect(service.start("recovery", undefined, "recovery-secret")).rejects.toMatchObject({
      status: 404,
      code: "recovery_unavailable",
    })
    expect(identityRecords.audit).toHaveBeenCalledWith({
      event: "membership.recovery",
      outcome: "denied",
      actorUserId: null,
      sessionId: null,
      authenticationProviderRevisionId: providerRevision.id,
      context: { reason: "active_administrator_exists" },
    })
    expect(identityRecords.createAuthorizationAttempt).not.toHaveBeenCalled()
  })

  it("audits missing recovery proof without recording the submitted request", async () => {
    const identityRecords = records()
    const service = createAuthenticationService({
      ...dependencies(identityRecords),
      recoverySecret: "recovery-secret",
    })

    await expect(service.start("recovery")).rejects.toMatchObject({
      status: 404,
      code: "recovery_unavailable",
    })
    expect(identityRecords.audit).toHaveBeenCalledWith({
      event: "membership.recovery",
      outcome: "denied",
      actorUserId: null,
      sessionId: null,
      authenticationProviderRevisionId: providerRevision.id,
      context: { reason: "secret_missing" },
    })
    expect(JSON.stringify(identityRecords.audit.mock.calls)).not.toContain("recovery-secret")
    expect(identityRecords.createAuthorizationAttempt).not.toHaveBeenCalled()
  })

  it("does not turn a failed denied-audit write into a normal enrollment rejection", async () => {
    const identityRecords = records({
      audit: vi.fn().mockRejectedValue(new Error("audit failed")),
    })
    const service = createAuthenticationService({
      ...dependencies(identityRecords),
      bootstrapSecret: "bootstrap-secret",
    })

    await expect(service.start("bootstrap", undefined, "wrong-secret")).rejects.toThrow(
      "audit failed",
    )
    expect(identityRecords.createAuthorizationAttempt).not.toHaveBeenCalled()
  })

  it("lets a compatibility admission policy deny sign-in before creating identity records", async () => {
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
    })
    const admissionPolicy = {
      name: "legacy-repository" as const,
      admit: vi.fn().mockResolvedValue(false),
    }
    const options = dependencies(identityRecords, { admissionPolicy })
    options.github.identify.mockResolvedValue({
      subject: "42",
      username: "octocat",
      displayName: null,
      avatarUrl: null,
    })
    const service = createAuthenticationService(options)

    await expect(service.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 403,
      code: "admission_denied",
    })
    expect(admissionPolicy.admit).toHaveBeenCalledWith(expect.objectContaining({ subject: "42" }))
    expect(identityRecords.createUser).not.toHaveBeenCalled()
    expect(identityRecords.createSession).not.toHaveBeenCalled()
  })

  it("refreshes authorization only when GitHub returns the session's same external identity", async () => {
    const session = {
      id: "session",
      userId: "user",
      externalIdentityId: "identity",
      authenticationProviderRevisionId: providerRevision.id,
      tokenDigest: "digest",
      signedInAt: now,
      freshAuthorizedAt: null,
      user: { id: "user", displayName: "User", avatarUrl: null },
      externalIdentity: {
        id: "identity",
        userId: "user",
        provider: "github",
        issuer: configuration.issuer,
        subject: "42",
        username: "octocat",
        displayName: null,
        avatarUrl: null,
      },
      authenticationProviderRevision: providerRevision,
    }
    const identityRecords = records({
      consumeAuthorizationAttempt: vi
        .fn()
        .mockResolvedValue(attempt({ purpose: "verify", originatingSessionId: session.id })),
      sessionById: vi.fn().mockResolvedValue(session),
    })
    const options = dependencies(identityRecords)
    options.github.identify.mockResolvedValue({
      subject: "99",
      username: "different-user",
      displayName: null,
      avatarUrl: null,
    })
    const service = createAuthenticationService(options)

    await expect(service.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 403,
      code: "identity_mismatch",
    })
    expect(identityRecords.verifySession).not.toHaveBeenCalled()

    options.github.identify.mockResolvedValue({
      subject: "42",
      username: "renamed-user",
      displayName: null,
      avatarUrl: null,
    })
    identityRecords.consumeAuthorizationAttempt.mockResolvedValueOnce(
      attempt({ purpose: "verify", originatingSessionId: session.id }),
    )
    await expect(service.complete("code", "state", "browser-token")).resolves.toEqual({
      purpose: "verify",
    })
    expect(identityRecords.verifySession).toHaveBeenCalledWith(session.id, now)
  })

  it("signs out only the current session and requires administrator proof strictly younger than five minutes to revoke all", async () => {
    const current = {
      id: "current-session",
      userId: "user",
      externalIdentityId: "identity",
      authenticationProviderRevisionId: providerRevision.id,
      tokenDigest: digestSecret("session-token"),
      signedInAt: now,
      freshAuthorizedAt: new Date(now.getTime() - 5 * 60_000),
      user: { id: "user", displayName: "Administrator", avatarUrl: null },
      externalIdentity: {
        id: "identity",
        userId: "user",
        provider: "github",
        issuer: configuration.issuer,
        subject: "42",
        username: "octocat",
        displayName: null,
        avatarUrl: null,
      },
      authenticationProviderRevision: providerRevision,
    }
    const identityRecords = records({
      session: vi.fn().mockResolvedValue(current),
      membership: vi.fn().mockResolvedValue({
        id: "membership",
        userId: "user",
        status: "active",
        role: "administrator",
        source: "manual",
      }),
    })
    const service = createAuthenticationService(dependencies(identityRecords))

    await service.signOut("session-token")
    expect(identityRecords.deleteSession).toHaveBeenCalledWith(current.id)
    expect(identityRecords.deleteSessions).not.toHaveBeenCalled()

    await expect(service.revokeAll("session-token")).rejects.toMatchObject({
      status: 403,
      code: "fresh_authorization_required",
    })
    expect(identityRecords.advanceSessionGeneration).not.toHaveBeenCalled()

    current.freshAuthorizedAt = new Date(now.getTime() + 1)
    await expect(service.revokeAll("session-token")).rejects.toMatchObject({
      status: 403,
      code: "fresh_authorization_required",
    })

    current.freshAuthorizedAt = new Date(now.getTime() - (5 * 60_000 - 1))
    await service.revokeAll("session-token")
    expect(identityRecords.advanceSessionGeneration).toHaveBeenCalledOnce()
    expect(identityRecords.deleteSessions).toHaveBeenCalledOnce()
  })
})
