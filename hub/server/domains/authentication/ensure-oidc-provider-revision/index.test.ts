import { describe, expect, it, vi } from "vitest"

import { ensureOidcProviderRevision } from "#server/domains/authentication/ensure-oidc-provider-revision"
import type { IdentityRecords, IdentityStore } from "#server/domains/identity/create-store/types"
import type { OidcConfiguration } from "#server/integrations/oidc/create-client/types"
import { digestSecret } from "#server/utils/digest-secret"

const configuration: OidcConfiguration = {
  issuer: "https://login.example.test/tenant/v2.0",
  clientId: "hub-client",
  clientSecret: "client-secret-fixture",
  clientCredentialReference: "HUB_OIDC_CLIENT_SECRET",
  callbackUrl: "https://hub.example.test/api/auth/oidc/callback",
  scopes: ["openid", "profile", "email"],
  memberRole: "Hub.User",
  administratorRole: "Hub.Administrator",
  membershipPolicy: "invitation-required",
  enabled: true,
  providerRevision: 4,
}

function storedConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    clientId: configuration.clientId,
    callbackUrl: configuration.callbackUrl,
    clientCredentialReference: configuration.clientCredentialReference,
    credentialFingerprint: digestSecret(configuration.clientSecret),
    scopes: [...configuration.scopes].sort(),
    memberRole: configuration.memberRole,
    administratorRole: configuration.administratorRole,
    membershipPolicy: configuration.membershipPolicy,
    ...overrides,
  }
}

function revision(overrides: Record<string, unknown> = {}) {
  return {
    id: "revision-4",
    authenticationProviderId: "provider",
    revision: 4,
    issuer: configuration.issuer,
    configuration: storedConfiguration(),
    authenticationProvider: {
      id: "provider",
      key: "oidc",
      type: "oidc",
      enabled: true,
    },
    ...overrides,
  }
}

function store(latest: ReturnType<typeof revision> | null) {
  const createRevision = vi.fn()
  const records = {
    latestAuthenticationProviderRevision: vi.fn().mockResolvedValue(latest),
    createAuthenticationProviderRevision: createRevision,
  } as unknown as IdentityRecords
  const identityStore: IdentityStore = {
    read: records,
    lock: (operation) => operation(records, {} as never),
  }
  return {
    records: records as IdentityRecords & {
      latestAuthenticationProviderRevision: ReturnType<typeof vi.fn>
      createAuthenticationProviderRevision: ReturnType<typeof vi.fn>
    },
    createRevision,
    identityStore,
  }
}

describe("ensureOidcProviderRevision()", () => {
  it("reuses the same revision when issuer, enabled status, and nonsecret configuration match", async () => {
    const existing = revision()
    const fixture = store(existing)

    await expect(ensureOidcProviderRevision(fixture.identityStore, configuration)).resolves.toBe(
      existing,
    )
    expect(fixture.createRevision).not.toHaveBeenCalled()
  })

  it("reuses the same revision when stored JSON keys and scopes have a different order", async () => {
    const existing = revision({
      configuration: {
        membershipPolicy: configuration.membershipPolicy,
        administratorRole: configuration.administratorRole,
        memberRole: configuration.memberRole,
        scopes: ["profile", "email", "openid"],
        credentialFingerprint: digestSecret(configuration.clientSecret),
        clientCredentialReference: configuration.clientCredentialReference,
        callbackUrl: configuration.callbackUrl,
        clientId: configuration.clientId,
      },
    })
    const fixture = store(existing)

    await expect(ensureOidcProviderRevision(fixture.identityStore, configuration)).resolves.toBe(
      existing,
    )
    expect(fixture.createRevision).not.toHaveBeenCalled()
  })

  it("rejects configuration drift without an increased revision", async () => {
    const fixture = store(
      revision({
        configuration: storedConfiguration({ scopes: ["openid", "profile"] }),
      }),
    )

    await expect(ensureOidcProviderRevision(fixture.identityStore, configuration)).rejects.toThrow(
      "HUB_OIDC_PROVIDER_REVISION must increase when OIDC configuration changes.",
    )
    expect(fixture.createRevision).not.toHaveBeenCalled()
  })

  it("rejects a provider revision rollback", async () => {
    const fixture = store(revision({ revision: 5 }))

    await expect(ensureOidcProviderRevision(fixture.identityStore, configuration)).rejects.toThrow(
      "HUB_OIDC_PROVIDER_REVISION cannot roll back an existing provider.",
    )
    expect(fixture.createRevision).not.toHaveBeenCalled()
  })

  it("persists an increased revision with enabled status, reference, and fingerprint but no credential", async () => {
    const fixture = store(revision({ revision: 3, id: "revision-3" }))
    const created = revision()
    fixture.createRevision.mockResolvedValue(created)

    await expect(ensureOidcProviderRevision(fixture.identityStore, configuration)).resolves.toBe(
      created,
    )

    expect(fixture.createRevision).toHaveBeenCalledWith({
      key: "oidc",
      type: "oidc",
      enabled: true,
      revision: 4,
      issuer: configuration.issuer,
      configuration: storedConfiguration(),
    })
    const persisted = JSON.stringify(fixture.createRevision.mock.calls)
    expect(persisted).toContain(configuration.clientCredentialReference)
    expect(persisted).toContain(digestSecret(configuration.clientSecret))
    expect(persisted).not.toContain(configuration.clientSecret)
  })
})
