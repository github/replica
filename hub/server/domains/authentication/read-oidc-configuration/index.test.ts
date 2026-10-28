import { describe, expect, it } from "vitest"

import { readOidcConfiguration } from "#server/domains/authentication/read-oidc-configuration"

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HUB_OIDC_ENABLED: "true",
    HUB_OIDC_ISSUER: "https://login.microsoftonline.com/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0",
    HUB_OIDC_CLIENT_ID: "hub-client",
    HUB_OIDC_CLIENT_CREDENTIAL_REFERENCE: "HUB_OIDC_CLIENT_SECRET",
    HUB_OIDC_CLIENT_SECRET: "client-secret-fixture",
    HUB_OIDC_CALLBACK_URL: "https://hub.example.test/api/auth/oidc/callback",
    HUB_OIDC_SCOPES: "openid profile email",
    HUB_OIDC_MEMBER_ROLE: "Hub.User",
    HUB_OIDC_ADMINISTRATOR_ROLE: "Hub.Administrator",
    HUB_OIDC_MEMBERSHIP_POLICY: "invitation-required",
    HUB_OIDC_PROVIDER_REVISION: "4",
    ...overrides,
  }
}

const origin = new URL("https://hub.example.test")

describe("readOidcConfiguration()", () => {
  it("returns a complete configuration with the credential resolved only through its reference", () => {
    expect(readOidcConfiguration(environment(), origin)).toEqual({
      issuer: "https://login.microsoftonline.com/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0",
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
    })
  })

  it("normalizes tenant UUID case and a trailing issuer slash", () => {
    const configuration = readOidcConfiguration(
      environment({
        HUB_OIDC_ISSUER:
          "https://login.microsoftonline.com/A0B1C2D3-E4F5-4A67-8B9C-0D1E2F3A4B5C/v2.0/",
      }),
      origin,
    )

    expect(configuration.issuer).toBe(
      "https://login.microsoftonline.com/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0",
    )
  })

  it("fails closed when the referenced credential is missing", () => {
    const input = environment()
    delete input.HUB_OIDC_CLIENT_SECRET

    expect(() => readOidcConfiguration(input, origin)).toThrow(
      "Set HUB_OIDC_CLIENT_SECRET when HUB_AUTH_PROVIDER=oidc.",
    )
  })

  it("rejects a callback that does not exactly match the Hub OIDC callback", () => {
    expect(() =>
      readOidcConfiguration(
        environment({
          HUB_OIDC_CALLBACK_URL: "https://hub.example.test/api/auth/oidc/other-callback",
        }),
        origin,
      ),
    ).toThrow("HUB_OIDC_CALLBACK_URL must match the Hub OIDC callback URL.")
  })

  it("rejects an insecure issuer before accepting provider configuration", () => {
    expect(() =>
      readOidcConfiguration(
        environment({
          HUB_OIDC_ISSUER:
            "http://login.microsoftonline.com/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0",
        }),
        origin,
      ),
    ).toThrow("HUB_OIDC_ISSUER must be https://login.microsoftonline.com/<tenant-id>/v2.0.")
  })

  it.each([
    [
      "a generic provider host",
      "https://login.example.test/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0",
    ],
    ["a private address", "https://10.0.0.1/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0"],
    [
      "a DNS rebinding-capable host",
      "https://127.0.0.1.nip.io/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0",
    ],
    [
      "a Microsoft login alias",
      "https://login.windows.net/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0",
    ],
    [
      "an explicit port",
      "https://login.microsoftonline.com:443/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0",
    ],
  ])("rejects %s", (_description, issuer) => {
    expect(() => readOidcConfiguration(environment({ HUB_OIDC_ISSUER: issuer }), origin)).toThrow(
      "HUB_OIDC_ISSUER must be https://login.microsoftonline.com/<tenant-id>/v2.0.",
    )
  })

  it.each([
    ["a tenant alias", "organizations"],
    ["a non-UUID tenant", "tenant"],
    ["a truncated UUID", "a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5"],
  ])("rejects %s in the tenant segment", (_description, tenant) => {
    expect(() =>
      readOidcConfiguration(
        environment({
          HUB_OIDC_ISSUER: `https://login.microsoftonline.com/${tenant}/v2.0`,
        }),
        origin,
      ),
    ).toThrow("HUB_OIDC_ISSUER must be https://login.microsoftonline.com/<tenant-id>/v2.0.")
  })

  it.each([
    ["without openid", "profile email"],
    ["without profile", "openid email"],
    ["with offline_access", "openid profile email offline_access"],
  ])("rejects scopes %s", (_description, scopes) => {
    expect(() => readOidcConfiguration(environment({ HUB_OIDC_SCOPES: scopes }), origin)).toThrow(
      "HUB_OIDC_SCOPES must include openid and profile and must not request offline_access.",
    )
  })

  it("rejects an unknown membership policy instead of falling back to JIT admission", () => {
    expect(() =>
      readOidcConfiguration(
        environment({ HUB_OIDC_MEMBERSHIP_POLICY: "provider-default" }),
        origin,
      ),
    ).toThrow("HUB_OIDC_MEMBERSHIP_POLICY must be jit-assignment or invitation-required.")
  })

  it.each(["0", "-1", "1.5", "not-a-number"])(
    "rejects invalid provider revision %s",
    (providerRevision) => {
      expect(() =>
        readOidcConfiguration(
          environment({ HUB_OIDC_PROVIDER_REVISION: providerRevision }),
          origin,
        ),
      ).toThrow("HUB_OIDC_PROVIDER_REVISION must be a positive integer.")
    },
  )

  it("rejects the largest safe integer because a later provider change cannot increment it", () => {
    expect(() =>
      readOidcConfiguration(
        environment({ HUB_OIDC_PROVIDER_REVISION: String(Number.MAX_SAFE_INTEGER) }),
        origin,
      ),
    ).toThrow("HUB_OIDC_PROVIDER_REVISION must be an incrementable positive integer.")
  })
})
