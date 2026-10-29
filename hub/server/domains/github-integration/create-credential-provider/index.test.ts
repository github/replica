import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createGitHubIntegrationCredentialProvider } from "#server/domains/github-integration/create-credential-provider"

function credentials() {
  return {
    appId: "12345",
    installationId: "7",
    clientId: "test-client",
    clientSecret: "synthetic-client-secret",
    privateKey: generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey,
  }
}

describe("createGitHubIntegrationCredentialProvider()", () => {
  it("starts unconfigured and encrypts database credentials with fresh authenticated ciphertext", () => {
    const provider = createGitHubIntegrationCredentialProvider({
      HUB_GITHUB_CREDENTIAL_KEY: "ab".repeat(32),
    })
    const input = credentials()

    expect(provider.name).toBe("database")
    expect(provider.read({ encryptedCredentials: null })).toBeNull()
    const encrypted = provider.encrypt!(input)
    expect(provider.encrypt!(input)).not.toBe(encrypted)
    expect(provider.read({ encryptedCredentials: encrypted })).toEqual(input)
    expect(encrypted).not.toContain(input.clientSecret)
    expect(Buffer.from(encrypted, "base64").toString()).not.toContain(input.privateKey)

    const tampered = Buffer.from(encrypted, "base64")
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1
    expect(() => provider.read({ encryptedCredentials: tampered.toString("base64") })).toThrow()
    const otherKey = createGitHubIntegrationCredentialProvider({
      HUB_GITHUB_CREDENTIAL_KEY: "cd".repeat(32),
    })
    expect(() => otherKey.read({ encryptedCredentials: encrypted })).toThrow()
  })

  it("requires a valid encryption key outside the database", () => {
    for (const key of [undefined, "ab".repeat(31), "zz".repeat(32)]) {
      expect(() =>
        createGitHubIntegrationCredentialProvider({ HUB_GITHUB_CREDENTIAL_KEY: key }),
      ).toThrow()
    }
  })

  it("uses complete environment credentials read-only without consulting database ciphertext", () => {
    const input = credentials()
    const provider = createGitHubIntegrationCredentialProvider({
      HUB_GITHUB_CREDENTIAL_PROVIDER: "environment",
      GITHUB_APP_ID: input.appId,
      GITHUB_INSTALLATION_ID: input.installationId,
      GITHUB_CLIENT_ID: input.clientId,
      GITHUB_CLIENT_SECRET: input.clientSecret,
      GITHUB_PRIVATE_KEY: input.privateKey,
    })

    expect(provider.name).toBe("environment")
    expect(provider.encrypt).toBeUndefined()
    expect(provider.read({ encryptedCredentials: "not-database-credentials" })).toEqual(input)
  })

  it("rejects incomplete environment configuration and unknown providers instead of falling back", () => {
    const input = credentials()
    const environment = {
      HUB_GITHUB_CREDENTIAL_PROVIDER: "environment",
      HUB_GITHUB_CREDENTIAL_KEY: "ab".repeat(32),
      GITHUB_APP_ID: input.appId,
      GITHUB_INSTALLATION_ID: input.installationId,
      GITHUB_CLIENT_ID: input.clientId,
      GITHUB_CLIENT_SECRET: input.clientSecret,
      GITHUB_PRIVATE_KEY: input.privateKey,
    }
    for (const field of [
      "GITHUB_APP_ID",
      "GITHUB_INSTALLATION_ID",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GITHUB_PRIVATE_KEY",
    ] as const) {
      expect(() =>
        createGitHubIntegrationCredentialProvider({ ...environment, [field]: undefined }),
      ).toThrow()
    }
    expect(() =>
      createGitHubIntegrationCredentialProvider({
        ...environment,
        GITHUB_PRIVATE_KEY: "invalid",
      }),
    ).toThrow()
    expect(() =>
      createGitHubIntegrationCredentialProvider({
        ...environment,
        HUB_GITHUB_CREDENTIAL_PROVIDER: "other",
      }),
    ).toThrow()
  })
})
