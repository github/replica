import { describe, expect, it } from "vitest"

import { createClientSecretAuthenticationProvider } from "."

describe("createClientSecretAuthenticationProvider()", () => {
  it("keeps the secret out of revision configuration while returning it for the token request", async () => {
    const provider = createClientSecretAuthenticationProvider({
      reference: "ENTRA_OIDC_CLIENT_SECRET",
      secret: "client-secret-value",
    })

    expect(provider.canonicalPublicConfiguration).toEqual({
      mode: "client_secret",
      reference: "ENTRA_OIDC_CLIENT_SECRET",
    })
    expect(JSON.stringify(provider.canonicalPublicConfiguration)).not.toContain(
      "client-secret-value",
    )
    await expect(provider.createTokenRequestFields()).resolves.toEqual({
      client_secret: "client-secret-value",
    })
  })

  it("rejects an unnamed secret instead of falling back to another client authentication mode", () => {
    expect(() =>
      createClientSecretAuthenticationProvider({
        reference: "secret",
        secret: "client-secret-value",
      }),
    ).toThrow()
  })
})
