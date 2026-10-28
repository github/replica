import { describe, expect, it, vi } from "vitest"
import type { Mocked } from "vitest"

import { createAuthenticationService } from "#server/domains/authentication/create-service"
import type { IdentityRecords, IdentityStore } from "#server/domains/identity/create-store/types"
import type {
  OidcClient,
  OidcConfiguration,
  OidcProfile,
} from "#server/integrations/oidc/create-client/types"
import type { ExternalIdentityInput } from "#server/repositories/external-identities/types"
import type { InstallationMembershipInput } from "#server/repositories/installation-memberships/types"
import { digestSecret } from "#server/utils/digest-secret"

const now = new Date("2026-10-27T18:00:00.000Z")
const issuer = "https://login.example.test/tenant/v2.0"
const configuration: OidcConfiguration = {
  issuer,
  clientId: "hub-client",
  clientSecret: "client-secret-fixture",
  clientCredentialReference: "HUB_OIDC_CLIENT_SECRET",
  callbackUrl: "https://hub.example.test/api/auth/oidc/callback",
  scopes: ["openid", "profile", "email"],
  memberRole: "Hub.User",
  administratorRole: "Hub.Administrator",
  membershipPolicy: "jit-assignment",
  enabled: true,
  providerRevision: 4,
}
const providerRevision = {
  id: "oidc-revision-4",
  authenticationProviderId: "oidc-provider",
  revision: 4,
  issuer,
  configuration: {},
  authenticationProvider: {
    id: "oidc-provider",
    key: "oidc",
    type: "oidc",
    enabled: true,
  },
}

type MockIdentityRecords = Mocked<IdentityRecords>

function records(overrides: Partial<MockIdentityRecords> = {}) {
  return Object.assign(
    {
      currentAuthenticationProviderRevision: vi.fn().mockResolvedValue(providerRevision),
      identityStoreState: vi.fn().mockResolvedValue({ sessionGeneration: 7 }),
      createAuthorizationAttempt: vi.fn().mockResolvedValue(undefined),
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(null),
      externalIdentity: vi.fn().mockResolvedValue(null),
      externalIdentityByDirectoryObjectId: vi.fn().mockResolvedValue(null),
      createUser: vi.fn().mockResolvedValue({
        id: "user",
        displayName: "Member Name",
        avatarUrl: null,
      }),
      updateUser: vi.fn().mockResolvedValue({
        id: "user",
        displayName: "Member Name",
        avatarUrl: null,
      }),
      saveExternalIdentity: vi.fn().mockImplementation((input: ExternalIdentityInput) =>
        Promise.resolve({
          id: "identity",
          ...input,
          email: input.email ?? null,
          user: {
            id: input.userId,
            displayName: input.displayName,
            avatarUrl: input.avatarUrl,
          },
        }),
      ),
      createSession: vi.fn().mockResolvedValue({
        id: "session",
        userId: "user",
        externalIdentityId: "identity",
        authenticationProviderRevisionId: providerRevision.id,
        tokenDigest: "stored-digest",
        signedInAt: now,
        freshAuthorizedAt: now,
      }),
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
      saveMembership: vi.fn().mockImplementation((input: InstallationMembershipInput) =>
        Promise.resolve({
          id: "membership",
          suspendedAt: null,
          removedAt: null,
          ...input,
        }),
      ),
      audit: vi.fn(),
    },
    overrides,
  )
}

type TestRecords = ReturnType<typeof records>

function store(testRecords: TestRecords): IdentityStore {
  const typedRecords = testRecords as unknown as IdentityRecords
  return {
    read: typedRecords,
    lock: (operation) => operation(typedRecords, {} as never),
  }
}

function profile(overrides: Partial<OidcProfile> = {}): OidcProfile {
  return {
    subject: "immutable-subject",
    directoryObjectId: "a0e1d2c3-b4a5-4678-9abc-def012345678",
    username: "member@example.test",
    email: "member@example.test",
    displayName: "Member Name",
    avatarUrl: null,
    role: "member" as const,
    ...overrides,
  }
}

function oidc(overrides: Partial<Mocked<OidcClient>> = {}) {
  return Object.assign(
    {
      authorizationUrl: vi.fn((state, verifier, nonce) =>
        Promise.resolve(
          `https://login.example.test/authorize?state=${state}&verifier=${verifier}&nonce=${nonce}`,
        ),
      ),
      identify: vi.fn().mockResolvedValue(profile()),
    },
    overrides,
  )
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt",
    authenticationProviderRevisionId: providerRevision.id,
    originatingSessionId: null,
    stateDigest: digestSecret("state"),
    browserDigest: digestSecret("browser-token"),
    pkceVerifier: "pkce-verifier",
    nonce: "one-use-nonce",
    purpose: "sign-in" as const,
    sessionGeneration: 7,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  }
}

function service(
  testRecords: TestRecords,
  client = oidc(),
  overrides: Partial<OidcConfiguration> = {},
) {
  return {
    client,
    authentication: createAuthenticationService({
      store: store(testRecords),
      github: null,
      configuration: null,
      providerRevisionId: null,
      oidc: client,
      oidcConfiguration: { ...configuration, ...overrides },
      oidcProviderRevisionId: providerRevision.id,
      provider: "oidc",
      admissionPolicy: {
        name: "hub-managed",
        admit: vi.fn().mockResolvedValue(false),
      },
      now: () => now,
    }),
  }
}

function activeMembership(
  role: "member" | "administrator" = "member",
  source: InstallationMembershipInput["source"] = "oidc-assignment",
) {
  return {
    id: "membership",
    userId: "user",
    status: "active" as const,
    role,
    source,
    suspendedAt: null,
    removedAt: null,
  }
}

function existingIdentity() {
  return {
    id: "identity",
    userId: "user",
    provider: "oidc",
    issuer,
    subject: "immutable-subject",
    directoryObjectId: "a0e1d2c3-b4a5-4678-9abc-def012345678",
    username: "old-name@example.test",
    email: "old-email@example.test",
    displayName: "Old Name",
    avatarUrl: null,
    user: { id: "user", displayName: "Old Name", avatarUrl: null },
  }
}

describe("createAuthenticationService() OIDC", () => {
  it("starts a browser-bound attempt with one-use state, nonce, PKCE, and a ten-minute lifetime", async () => {
    const identityRecords = records()
    const { authentication, client } = service(identityRecords)

    const result = await authentication.start("sign-in")

    const url = new URL(result.authorizationUrl)
    const state = url.searchParams.get("state")
    const verifier = url.searchParams.get("verifier")
    const nonce = url.searchParams.get("nonce")
    expect(state).toMatch(/^[\w-]{43}$/)
    expect(result.browserToken).toMatch(/^[\w-]{43}$/)
    expect(verifier).toMatch(/^[\w-]{43}$/)
    expect(nonce).toMatch(/^[\w-]{43}$/)
    expect(client.authorizationUrl).toHaveBeenCalledWith(state, verifier, nonce)
    expect(identityRecords.createAuthorizationAttempt).toHaveBeenCalledWith({
      authenticationProviderRevisionId: providerRevision.id,
      originatingSessionId: null,
      stateDigest: digestSecret(state!),
      browserDigest: digestSecret(result.browserToken),
      pkceVerifier: verifier,
      nonce,
      purpose: "sign-in",
      sessionGeneration: 7,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    })
  })

  it("consumes the saved attempt and audits a provider failure when initiation discovery fails", async () => {
    const identityRecords = records()
    const client = oidc({
      authorizationUrl: vi.fn().mockRejectedValue(new Error("discovery unavailable")),
    })
    const { authentication } = service(identityRecords, client)

    await expect(authentication.start("sign-in")).rejects.toMatchObject({
      status: 503,
      code: "authentication_provider_failed",
    })

    const [{ stateDigest }] = identityRecords.createAuthorizationAttempt.mock.calls[0]!
    expect(identityRecords.consumeAuthorizationAttempt).toHaveBeenCalledWith(stateDigest)
    expect(identityRecords.audit).toHaveBeenCalledWith({
      event: "authentication.provider_failed",
      outcome: "failed",
      actorUserId: null,
      sessionId: null,
      authenticationProviderRevisionId: providerRevision.id,
    })
  })

  it("consumes the attempt before rejecting the wrong browser, preventing a valid replay", async () => {
    let available: ReturnType<typeof attempt> | null = attempt()
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn(() => {
        const result = available
        available = null
        return Promise.resolve(result)
      }),
    })
    const { authentication, client } = service(identityRecords)

    await expect(authentication.complete("code", "state", "wrong-browser")).rejects.toMatchObject({
      status: 401,
      code: "invalid_authorization",
    })
    await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 401,
      code: "invalid_authorization",
    })
    expect(client.identify).not.toHaveBeenCalled()
  })

  it("consumes a long-code attempt once before exchanging it and rejects a replay", async () => {
    const longCode = `oidc.${"Ab9_-".repeat(410)}`.slice(0, 2_048)
    let available: ReturnType<typeof attempt> | null = attempt()
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn(() => {
        const result = available
        available = null
        return Promise.resolve(result)
      }),
    })
    const client = oidc()
    const { authentication } = service(identityRecords, client)

    const result = await authentication.complete(longCode, "state", "browser-token")
    await expect(authentication.complete(longCode, "state", "browser-token")).rejects.toMatchObject(
      {
        status: 401,
        code: "invalid_authorization",
      },
    )

    expect(result.sessionToken).toEqual(expect.any(String))
    expect(identityRecords.consumeAuthorizationAttempt).toHaveBeenCalledTimes(2)
    expect(identityRecords.consumeAuthorizationAttempt).toHaveBeenNthCalledWith(
      1,
      digestSecret("state"),
    )
    expect(client.identify).toHaveBeenCalledOnce()
    expect(client.identify).toHaveBeenCalledWith(longCode, "pkce-verifier", "one-use-nonce")
    expect(identityRecords.consumeAuthorizationAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      client.identify.mock.invocationCallOrder[0]!,
    )
    expect(
      JSON.stringify([
        identityRecords.createUser.mock.calls,
        identityRecords.saveExternalIdentity.mock.calls,
        identityRecords.saveMembership.mock.calls,
        identityRecords.createSession.mock.calls,
        identityRecords.audit.mock.calls,
      ]),
    ).not.toContain(longCode)
  })

  it.each([
    ["expired", attempt({ expiresAt: now })],
    ["old provider revision", attempt({ authenticationProviderRevisionId: "superseded-revision" })],
  ])("rejects an %s attempt before exchanging its code", async (_name, savedAttempt) => {
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(savedAttempt),
    })
    const { authentication, client } = service(identityRecords)

    await expect(
      authentication.complete("provider-code", "state", "browser-token"),
    ).rejects.toMatchObject({ status: 401, code: "invalid_authorization" })
    expect(client.identify).not.toHaveBeenCalled()
  })

  it.each([
    [
      "provider changed",
      {
        currentAuthenticationProviderRevision: () => ({
          ...providerRevision,
          id: "new-revision",
        }),
        sessionGeneration: 7,
      },
    ],
    [
      "sessions revoked",
      {
        currentAuthenticationProviderRevision: () => providerRevision,
        sessionGeneration: 8,
      },
    ],
  ])("rejects an exchanged attempt after %s supersedes it", async (_name, scenario) => {
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      currentAuthenticationProviderRevision: vi
        .fn()
        .mockResolvedValue(scenario.currentAuthenticationProviderRevision()),
      identityStoreState: vi
        .fn()
        .mockResolvedValue({ sessionGeneration: scenario.sessionGeneration }),
    })
    const { authentication } = service(identityRecords)

    await expect(
      authentication.complete("provider-code", "state", "browser-token"),
    ).rejects.toMatchObject({ status: 401, code: "authorization_superseded" })
    expect(identityRecords.createSession).not.toHaveBeenCalled()
  })

  it.each([
    ["no mapped role", null],
    ["an unknown role", null],
  ])("denies sign-in with %s before persisting identity records", async (_name, role) => {
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
    })
    const client = oidc({ identify: vi.fn().mockResolvedValue(profile({ role })) })
    const { authentication } = service(identityRecords, client)

    await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 403,
      code: "admission_denied",
    })
    expect(identityRecords.createUser).not.toHaveBeenCalled()
    expect(identityRecords.createSession).not.toHaveBeenCalled()
  })

  it.each(["member", "administrator"] as const)(
    "maps a new %s claim to an active OIDC-assignment membership",
    async (role) => {
      const identityRecords = records({
        consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      })
      const client = oidc({ identify: vi.fn().mockResolvedValue(profile({ role })) })
      const { authentication } = service(identityRecords, client)

      const result = await authentication.complete("code", "state", "browser-token")

      expect(result.purpose).toBe("sign-in")
      expect(result.sessionToken).toEqual(expect.any(String))
      expect(identityRecords.saveMembership).toHaveBeenCalledWith({
        userId: "user",
        status: "active",
        role,
        source: "oidc-assignment",
        suspendedAt: null,
        removedAt: null,
      })
      expect(identityRecords.audit).toHaveBeenCalledWith({
        event: "membership.oidc_assignment.activate",
        outcome: "succeeded",
        actorUserId: "user",
        sessionId: null,
        authenticationProviderRevisionId: providerRevision.id,
        targetMembershipId: "membership",
        context: { reason: `role_${role}` },
      })
    },
  )

  it("reuses the immutable subject while refreshing mutable username, email, and name", async () => {
    const identity = existingIdentity()
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      externalIdentity: vi.fn().mockResolvedValue(identity),
      membership: vi.fn().mockResolvedValue(activeMembership()),
    })
    const client = oidc({
      identify: vi.fn().mockResolvedValue(
        profile({
          username: "renamed@example.test",
          email: "new-email@example.test",
          displayName: "New Name",
        }),
      ),
    })
    const { authentication } = service(identityRecords, client)

    await authentication.complete("code", "state", "browser-token")

    expect(identityRecords.createUser).not.toHaveBeenCalled()
    expect(identityRecords.updateUser).toHaveBeenCalledWith("user", {
      displayName: "New Name",
      avatarUrl: null,
    })
    expect(identityRecords.saveExternalIdentity).toHaveBeenCalledWith({
      userId: "user",
      provider: "oidc",
      issuer,
      subject: "immutable-subject",
      directoryObjectId: "a0e1d2c3-b4a5-4678-9abc-def012345678",
      username: "renamed@example.test",
      email: "new-email@example.test",
      displayName: "New Name",
      avatarUrl: null,
    })
  })

  it("denies a changed provider subject that reuses an existing directory object ID", async () => {
    const identity = existingIdentity()
    const membership = activeMembership()
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      externalIdentityByDirectoryObjectId: vi.fn().mockResolvedValue(identity),
      membership: vi.fn().mockResolvedValue(membership),
    })
    const client = oidc({
      identify: vi.fn().mockResolvedValue(profile({ subject: "replacement-subject" })),
    })
    const { authentication } = service(identityRecords, client)

    await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 403,
      code: "admission_denied",
    })

    expect(identityRecords.audit).toHaveBeenCalledWith({
      event: "authentication.admission_denied",
      outcome: "denied",
      actorUserId: "user",
      sessionId: null,
      authenticationProviderRevisionId: providerRevision.id,
      targetMembershipId: membership.id,
      context: { reason: "provider_subject_changed" },
    })
    expect(identityRecords.createUser).not.toHaveBeenCalled()
    expect(identityRecords.saveExternalIdentity).not.toHaveBeenCalled()
    expect(identityRecords.createSession).not.toHaveBeenCalled()
  })

  it("refreshes authorization only when the active membership still matches the signed provider role", async () => {
    const session = {
      id: "session",
      userId: "user",
      externalIdentityId: "identity",
      authenticationProviderRevisionId: providerRevision.id,
      tokenDigest: "digest",
      signedInAt: now,
      freshAuthorizedAt: null,
      user: { id: "user", displayName: "Member Name", avatarUrl: null },
      externalIdentity: existingIdentity(),
      authenticationProviderRevision: providerRevision,
    }
    const identityRecords = records({
      consumeAuthorizationAttempt: vi
        .fn()
        .mockResolvedValue(attempt({ purpose: "verify", originatingSessionId: session.id })),
      sessionById: vi.fn().mockResolvedValue(session),
      membership: vi.fn().mockResolvedValue(activeMembership("administrator")),
    })
    const client = oidc({ identify: vi.fn().mockResolvedValue(profile({ role: "member" })) })
    const { authentication } = service(identityRecords, client)

    await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 403,
      code: "provider_role_changed",
    })
    expect(identityRecords.verifySession).not.toHaveBeenCalled()
    expect(identityRecords.audit).toHaveBeenCalledWith({
      event: "session.verify",
      outcome: "denied",
      actorUserId: "user",
      sessionId: "session",
      authenticationProviderRevisionId: providerRevision.id,
      targetMembershipId: "membership",
      context: { reason: "provider_role_changed" },
    })

    identityRecords.consumeAuthorizationAttempt.mockResolvedValueOnce(
      attempt({ purpose: "verify", originatingSessionId: session.id }),
    )
    client.identify.mockResolvedValueOnce(profile({ role: null }))
    identityRecords.membership.mockResolvedValueOnce(activeMembership("member"))
    await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 403,
      code: "provider_role_changed",
    })

    identityRecords.consumeAuthorizationAttempt.mockResolvedValueOnce(
      attempt({ purpose: "verify", originatingSessionId: session.id }),
    )
    client.identify.mockResolvedValueOnce(profile({ role: "member" }))
    identityRecords.membership.mockResolvedValueOnce({
      ...activeMembership("member"),
      status: "suspended",
      suspendedAt: now,
    })
    await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 403,
      code: "provider_role_changed",
    })

    identityRecords.consumeAuthorizationAttempt.mockResolvedValueOnce(
      attempt({ purpose: "verify", originatingSessionId: session.id }),
    )
    identityRecords.membership.mockResolvedValueOnce(activeMembership("member"))
    await expect(authentication.complete("code", "state", "browser-token")).resolves.toEqual({
      purpose: "verify",
    })
    expect(identityRecords.verifySession).toHaveBeenCalledWith(session.id, now)
  })

  it.each(["invitation", "manual", "bootstrap", "recovery"] as const)(
    "preserves a %s role override when the provider still grants an admitted role",
    async (source) => {
      const membership = activeMembership("administrator", source)
      const identityRecords = records({
        consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
        externalIdentity: vi.fn().mockResolvedValue(existingIdentity()),
        membership: vi.fn().mockResolvedValue(membership),
      })
      const { authentication } = service(
        identityRecords,
        oidc({ identify: vi.fn().mockResolvedValue(profile({ role: "member" })) }),
      )

      await expect(
        authentication.complete("code", "state", "browser-token"),
      ).resolves.toMatchObject({ purpose: "sign-in" })

      expect(identityRecords.saveMembership).not.toHaveBeenCalled()
      expect(identityRecords.createSession).toHaveBeenCalledOnce()
    },
  )

  it.each(["invitation", "manual", "bootstrap", "recovery"] as const)(
    "verifies a %s role override while requiring an admitted provider role",
    async (source) => {
      const session = {
        id: "session",
        userId: "user",
        externalIdentityId: "identity",
        authenticationProviderRevisionId: providerRevision.id,
        tokenDigest: "digest",
        signedInAt: now,
        freshAuthorizedAt: null,
        user: { id: "user", displayName: "Member Name", avatarUrl: null },
        externalIdentity: existingIdentity(),
        authenticationProviderRevision: providerRevision,
      }
      const identityRecords = records({
        consumeAuthorizationAttempt: vi
          .fn()
          .mockResolvedValue(attempt({ purpose: "verify", originatingSessionId: session.id })),
        sessionById: vi.fn().mockResolvedValue(session),
        membership: vi.fn().mockResolvedValue(activeMembership("administrator", source)),
      })
      const client = oidc({ identify: vi.fn().mockResolvedValue(profile({ role: "member" })) })
      const { authentication } = service(identityRecords, client)

      await expect(authentication.complete("code", "state", "browser-token")).resolves.toEqual({
        purpose: "verify",
      })

      identityRecords.consumeAuthorizationAttempt.mockResolvedValueOnce(
        attempt({ purpose: "verify", originatingSessionId: session.id }),
      )
      client.identify.mockResolvedValueOnce(profile({ role: null }))
      await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject(
        {
          status: 403,
          code: "provider_role_changed",
        },
      )
      expect(identityRecords.verifySession).toHaveBeenCalledOnce()
    },
  )

  it("refuses a role refresh that would remove the final active administrator", async () => {
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      externalIdentity: vi.fn().mockResolvedValue(existingIdentity()),
      membership: vi.fn().mockResolvedValue(activeMembership("administrator")),
      activeAdministratorCount: vi.fn().mockResolvedValue(1),
    })
    const { authentication } = service(identityRecords)

    await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 403,
      code: "admission_denied",
    })
    expect(identityRecords.saveMembership).not.toHaveBeenCalled()
    expect(identityRecords.createSession).not.toHaveBeenCalled()
    expect(identityRecords.audit).toHaveBeenCalledWith(
      expect.objectContaining({ context: { reason: "last_administrator" } }),
    )
  })

  it.each([
    ["member", "administrator", "role_administrator"],
    ["administrator", "member", "role_member"],
  ] as const)(
    "refreshes an active %s to %s and audits the supported reason",
    async (currentRole, providerRole, reason) => {
      const membership = activeMembership(currentRole)
      const refreshedMembership = { ...membership, role: providerRole }
      const identityRecords = records({
        consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
        externalIdentity: vi.fn().mockResolvedValue(existingIdentity()),
        membership: vi.fn().mockResolvedValueOnce(membership).mockResolvedValueOnce(membership),
        activeAdministratorCount: vi.fn().mockResolvedValue(2),
        saveMembership: vi.fn().mockResolvedValue(refreshedMembership),
      })
      const { authentication } = service(
        identityRecords,
        oidc({ identify: vi.fn().mockResolvedValue(profile({ role: providerRole })) }),
      )

      await expect(
        authentication.complete("code", "state", "browser-token"),
      ).resolves.toMatchObject({ purpose: "sign-in" })

      expect(identityRecords.saveMembership).toHaveBeenCalledWith({
        userId: membership.userId,
        status: "active",
        role: providerRole,
        source: "oidc-assignment",
        suspendedAt: null,
        removedAt: null,
      })
      expect(identityRecords.audit).toHaveBeenCalledWith({
        event: "membership.provider_role.refresh",
        outcome: "succeeded",
        actorUserId: "user",
        sessionId: null,
        authenticationProviderRevisionId: providerRevision.id,
        targetMembershipId: membership.id,
        context: { reason },
      })
      expect(identityRecords.saveMembership.mock.invocationCallOrder[0]).toBeLessThan(
        identityRecords.audit.mock.invocationCallOrder.find(
          (order, index) =>
            identityRecords.audit.mock.calls[index]?.[0].event ===
            "membership.provider_role.refresh",
        )!,
      )
      expect(identityRecords.createSession).toHaveBeenCalledOnce()
    },
  )

  it("keeps a suspended member denied even when current provider claims still grant a role", async () => {
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      externalIdentity: vi.fn().mockResolvedValue(existingIdentity()),
      membership: vi.fn().mockResolvedValue({
        ...activeMembership(),
        status: "suspended",
        suspendedAt: now,
      }),
    })
    const { authentication } = service(identityRecords)

    await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 403,
      code: "admission_denied",
    })
    expect(identityRecords.saveMembership).not.toHaveBeenCalled()
    expect(identityRecords.createSession).not.toHaveBeenCalled()
  })

  it("requires a fresh exact invitation before reactivating a removed member", async () => {
    const removed = {
      ...activeMembership(),
      status: "removed" as const,
      removedAt: now,
    }
    const identity = existingIdentity()
    const deniedRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      externalIdentity: vi.fn().mockResolvedValue(identity),
      membership: vi.fn().mockResolvedValue(removed),
    })

    await expect(
      service(deniedRecords).authentication.complete("code", "state", "browser-token"),
    ).rejects.toMatchObject({ status: 403, code: "admission_denied" })

    const invitation = {
      id: "invitation",
      createdByUserId: "administrator",
      activatedIdentityId: null,
      activatedMembershipId: null,
      provider: "oidc",
      issuer,
      subject: "a0e1d2c3-b4a5-4678-9abc-def012345678",
      role: "member" as const,
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
      revokedAt: null,
      createdAt: now,
    }
    const invitedRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      externalIdentity: vi.fn().mockResolvedValue(identity),
      membership: vi.fn().mockResolvedValue(removed),
      usableInvitation: vi.fn().mockResolvedValue(invitation),
    })

    const invitedResult = await service(invitedRecords).authentication.complete(
      "code",
      "state",
      "browser-token",
    )
    expect(invitedResult.sessionToken).toEqual(expect.any(String))
    expect(invitedRecords.usableInvitation).toHaveBeenCalledWith(
      "oidc",
      issuer,
      "a0e1d2c3-b4a5-4678-9abc-def012345678",
      now,
    )
    expect(invitedRecords.saveMembership).toHaveBeenCalledWith({
      userId: "user",
      status: "active",
      role: "member",
      source: "invitation",
      suspendedAt: null,
      removedAt: null,
    })
    expect(invitedRecords.consumeInvitation).toHaveBeenCalledWith(
      "invitation",
      "identity",
      "membership",
      now,
    )
  })

  it("activates a pre-sign-in invitation by directory object ID while retaining the OIDC subject", async () => {
    const invitation = {
      id: "invitation",
      createdByUserId: "administrator",
      activatedIdentityId: null,
      activatedMembershipId: null,
      provider: "oidc",
      issuer,
      subject: "a0e1d2c3-b4a5-4678-9abc-def012345678",
      role: "member" as const,
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
      revokedAt: null,
      createdAt: now,
    }
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
      usableInvitation: vi.fn().mockResolvedValue(invitation),
    })

    await service(identityRecords, oidc(), {
      membershipPolicy: "invitation-required",
    }).authentication.complete("code", "state", "browser-token")

    expect(identityRecords.usableInvitation).toHaveBeenCalledWith(
      "oidc",
      issuer,
      "a0e1d2c3-b4a5-4678-9abc-def012345678",
      now,
    )
    expect(identityRecords.saveExternalIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "oidc",
        issuer,
        subject: "immutable-subject",
        directoryObjectId: "a0e1d2c3-b4a5-4678-9abc-def012345678",
      }),
    )
  })

  it.each([
    ["bootstrap", "membership.bootstrap", "unavailable"],
    ["recovery", "membership.recovery", "active_administrator_exists"],
  ] as const)(
    "audits a %s denial when enrollment becomes unavailable after initiation",
    async (purpose, event, reason) => {
      const identityRecords = records({
        consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt({ purpose })),
        completeBootstrap: vi.fn().mockResolvedValue(purpose !== "bootstrap"),
        activeAdministratorCount: vi.fn().mockResolvedValue(purpose === "recovery" ? 1 : 0),
      })
      const { authentication } = service(
        identityRecords,
        oidc({ identify: vi.fn().mockResolvedValue(profile({ role: "administrator" })) }),
      )

      await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject(
        {
          status: 403,
          code: "admission_denied",
        },
      )
      expect(identityRecords.audit).toHaveBeenCalledWith({
        event,
        outcome: "denied",
        actorUserId: null,
        sessionId: null,
        authenticationProviderRevisionId: providerRevision.id,
        context: { reason },
      })
      expect(identityRecords.createSession).not.toHaveBeenCalled()
    },
  )

  it("keeps invitation-required admission distinct from just-in-time assignment", async () => {
    const invitationRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
    })

    await expect(
      service(invitationRecords, oidc(), {
        membershipPolicy: "invitation-required",
      }).authentication.complete("code", "state", "browser-token"),
    ).rejects.toMatchObject({ status: 403, code: "admission_denied" })
    expect(invitationRecords.createUser).not.toHaveBeenCalled()

    const jitRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
    })
    const jitResult = await service(jitRecords).authentication.complete(
      "code",
      "state",
      "browser-token",
    )
    expect(jitResult.sessionToken).toEqual(expect.any(String))
    expect(jitRecords.saveMembership).toHaveBeenCalledWith(
      expect.objectContaining({ source: "oidc-assignment" }),
    )
  })

  it("stores only an opaque Hub session digest and never passes provider secrets to persistence or audit", async () => {
    const identityRecords = records({
      consumeAuthorizationAttempt: vi.fn().mockResolvedValue(attempt()),
    })
    const client = oidc()
    const { authentication } = service(identityRecords, client)

    const result = await authentication.complete(
      "provider-authorization-code",
      "state",
      "browser-token",
    )

    expect(client.identify).toHaveBeenCalledWith(
      "provider-authorization-code",
      "pkce-verifier",
      "one-use-nonce",
    )
    expect(identityRecords.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenDigest: digestSecret(result.sessionToken!),
        authenticationProviderRevisionId: providerRevision.id,
      }),
    )
    const persistence = JSON.stringify([
      identityRecords.createUser.mock.calls,
      identityRecords.saveExternalIdentity.mock.calls,
      identityRecords.saveMembership.mock.calls,
      identityRecords.createSession.mock.calls,
      identityRecords.audit.mock.calls,
    ])
    expect(persistence).not.toMatch(
      /provider-authorization-code|client-secret-fixture|browser-token|pkce-verifier|one-use-nonce/,
    )
  })
})
