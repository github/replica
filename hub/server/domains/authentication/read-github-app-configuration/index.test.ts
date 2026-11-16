import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"

import { readGitHubAppConfiguration } from "."

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const encodedKey = Buffer.from(
  privateKey.export({ format: "pem", type: "pkcs1" }).toString(),
).toString("base64")

const signIn = {
  GITHUB_CLIENT_ID: "Iv1.client",
  GITHUB_CLIENT_SECRET: "client-secret",
  GITHUB_PROVIDER_REVISION: "1",
}
const app = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_INSTALLATION_ID: "67890",
  GITHUB_APP_PRIVATE_KEY_BASE64: encodedKey,
  GITHUB_WEBHOOK_SECRET: "webhook-secret-of-at-least-twenty",
}

describe("readGitHubAppConfiguration()", () => {
  it("reports not configured without problems when nothing is set", () => {
    const result = readGitHubAppConfiguration({})

    expect(result.status).toBe("not_configured")
    expect(result.problems).toEqual([])
    expect(result.signInCredentials).toBeUndefined()
  })

  it("parses complete sign-in and App credentials", () => {
    const result = readGitHubAppConfiguration({ ...signIn, ...app })

    expect(result.status).toBe("configured")
    expect(result.signInCredentials).toEqual({
      clientId: "Iv1.client",
      clientSecret: "client-secret",
      providerRevision: 1,
    })
    expect(result.appCredentials?.privateKey.asymmetricKeyType).toBe("rsa")
  })

  it("lists all missing App settings when only sign-in settings are present", () => {
    const result = readGitHubAppConfiguration(signIn)

    expect(result.signIn).toBe("configured")
    expect(result.app).toBe("not_configured")
    expect(result.status).toBe("incomplete")
    expect(result.problems).toEqual([
      { key: "GITHUB_APP_ID", state: "missing" },
      { key: "GITHUB_APP_PRIVATE_KEY_BASE64", state: "missing" },
      { key: "GITHUB_APP_INSTALLATION_ID", state: "missing" },
      { key: "GITHUB_WEBHOOK_SECRET", state: "missing" },
    ])
  })

  it("names missing and invalid settings without exposing values", () => {
    const result = readGitHubAppConfiguration({
      ...signIn,
      GITHUB_PROVIDER_REVISION: "0",
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from("not a key").toString("base64"),
    })

    expect(result.signIn).toBe("incomplete")
    expect(result.signInCredentials).toBeUndefined()
    expect(result.problems).toEqual([
      { key: "GITHUB_PROVIDER_REVISION", state: "invalid" },
      { key: "GITHUB_APP_PRIVATE_KEY_BASE64", state: "invalid" },
      { key: "GITHUB_APP_INSTALLATION_ID", state: "missing" },
      { key: "GITHUB_WEBHOOK_SECRET", state: "missing" },
    ])
    expect(JSON.stringify(result.problems)).not.toContain("client-secret")
  })

  it("rejects malformed base64 even when it decodes to a valid key", () => {
    const result = readGitHubAppConfiguration({
      ...signIn,
      ...app,
      GITHUB_APP_PRIVATE_KEY_BASE64: `${encodedKey}!`,
    })

    expect(result.status).toBe("incomplete")
    expect(result.settings.GITHUB_APP_PRIVATE_KEY_BASE64).toBe("invalid")
    expect(result.appCredentials).toBeUndefined()
  })

  it("rejects IDs that cannot be represented safely by GitHub authentication", () => {
    const result = readGitHubAppConfiguration({
      ...signIn,
      ...app,
      GITHUB_APP_INSTALLATION_ID: "9007199254740992",
    })

    expect(result.status).toBe("incomplete")
    expect(result.settings.GITHUB_APP_INSTALLATION_ID).toBe("invalid")
  })
})
