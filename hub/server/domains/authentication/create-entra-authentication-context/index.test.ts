import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createEntraAuthenticationContext } from "."

const issuer = "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0"

describe("createEntraAuthenticationContext()", () => {
  it("builds the exact tenant callback and excludes the client secret from revision identity", () => {
    const context = createEntraAuthenticationContext({
      HUB_APPLICATION_ORIGIN: "https://hub.example.test",
      HUB_AUTHENTICATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
      ENTRA_OIDC_CLIENT_AUTHENTICATION: "client-secret",
      ENTRA_OIDC_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
      ENTRA_OIDC_CLIENT_SECRET: "client-secret-value",
      ENTRA_OIDC_ISSUER: issuer,
      ENTRA_OIDC_PROVIDER_REVISION: "3",
    })

    expect(context.callbackUri).toBe("https://hub.example.test/api/auth/entra/callback")
    expect(context.providerRevision).toBe(3)
    expect(context.requiresProviderAssignmentEvidence).toBe(true)
    expect(context.requiresFreshAdministratorEnrollment).toBe(true)
    expect(context.secureCookie).toBe(true)
    expect(context.adapter.canonicalPublicConfiguration).not.toContain("client-secret-value")
    expect(context.configurationDigest).toBe(
      createHash("sha256").update(context.adapter.canonicalPublicConfiguration).digest("hex"),
    )
  })

  it("requires one explicit client authentication mode with no fallback", () => {
    expect(() =>
      createEntraAuthenticationContext({
        HUB_APPLICATION_ORIGIN: "https://hub.example.test",
        HUB_AUTHENTICATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
        HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
        ENTRA_OIDC_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
        ENTRA_OIDC_CLIENT_SECRET: "client-secret-value",
        ENTRA_OIDC_ISSUER: issuer,
        ENTRA_OIDC_PROVIDER_REVISION: "3",
      }),
    ).toThrow()
  })
})
