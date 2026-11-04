import { beforeEach, describe, expect, it, vi } from "vitest"

const getToken = vi.fn<(scope: string) => Promise<{ token: string } | null>>()
const credential = vi.fn()

vi.mock("@azure/identity", () => ({
  ManagedIdentityCredential: class {
    constructor(input: unknown) {
      credential(input)
    }

    getToken(scope: string): Promise<{ token: string } | null> {
      return getToken(scope)
    }
  },
}))

import { createManagedIdentityAuthenticationProvider } from "."

describe("createManagedIdentityAuthenticationProvider()", () => {
  beforeEach(() => {
    getToken.mockResolvedValue({ token: "managed-identity-assertion" })
  })

  it("requests only the Azure token-exchange assertion for the configured user-assigned identity", async () => {
    const provider = createManagedIdentityAuthenticationProvider({
      clientId: "11111111-1111-4111-8111-111111111111",
    })

    expect(credential).toHaveBeenCalledWith({
      clientId: "11111111-1111-4111-8111-111111111111",
    })
    expect(provider.canonicalPublicConfiguration).toEqual({
      managedIdentityClientId: "11111111-1111-4111-8111-111111111111",
      mode: "managed_identity_client_assertion",
    })
    await expect(provider.createTokenRequestFields()).resolves.toEqual({
      client_assertion: "managed-identity-assertion",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    })
    expect(getToken).toHaveBeenCalledWith("api://AzureADTokenExchange/.default")
  })

  it("fails closed when managed identity returns no assertion", async () => {
    getToken.mockResolvedValueOnce(null)
    const provider = createManagedIdentityAuthenticationProvider({
      clientId: "11111111-1111-4111-8111-111111111111",
    })

    await expect(provider.createTokenRequestFields()).rejects.toThrow(
      "did not return an OIDC client assertion",
    )
  })
})
