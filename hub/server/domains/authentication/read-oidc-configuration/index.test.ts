import { describe, expect, it } from "vitest"

import { readOidcConfiguration } from "#server/domains/authentication/read-oidc-configuration"

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HUB_OIDC_ENABLED: "true",
    HUB_OIDC_ISSUER: "https://login.example.test/tenant/v2.0",
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
    })
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
        environment({ HUB_OIDC_ISSUER: "http://login.example.test/tenant/v2.0" }),
        origin,
      ),
    ).toThrow("HUB_OIDC_ISSUER must be an HTTPS URL")
  })

  it("rejects offline_access so Hub cannot receive a provider refresh token", () => {
    expect(() =>
      readOidcConfiguration(
        environment({ HUB_OIDC_SCOPES: "openid profile email offline_access" }),
        origin,
      ),
    ).toThrow("HUB_OIDC_SCOPES must include openid and must not request offline_access.")
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
