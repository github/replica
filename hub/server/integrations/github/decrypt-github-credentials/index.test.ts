import { createCipheriv } from "node:crypto"
import { describe, expect, it } from "vitest"

import { decryptGitHubCredentials } from "#server/integrations/github/decrypt-github-credentials"
import { credentialContext } from "#server/integrations/github/encrypt-github-credentials/constants"
import { encryptGitHubCredentials } from "#server/integrations/github/encrypt-github-credentials"
import { GitHubError } from "#server/integrations/github/github-error"

function encryptPlaintext(key: Buffer, plaintext: string) {
  const nonce = Buffer.alloc(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(credentialContext)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64")
}

describe("decryptGitHubCredentials()", () => {
  it("preserves credential validation errors after decrypting and parsing credentials", () => {
    const key = Buffer.alloc(32)
    const encrypted = encryptGitHubCredentials(key, {
      appId: "12345",
      installationId: "7",
      clientId: "",
      clientSecret: "synthetic-client-secret",
      privateKey: "not-used-after-schema-validation",
    })

    let error: unknown
    try {
      decryptGitHubCredentials(key, encrypted)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(GitHubError)
    expect(error).toMatchObject({
      code: "invalid_credentials",
      message:
        "Supply the GitHub App ID, installation ID, client ID, client secret, and RSA private key.",
    })
  })

  it.each([
    ["malformed ciphertext", "not-ciphertext"],
    ["malformed JSON", encryptPlaintext(Buffer.alloc(32), "{")],
  ])("reports %s as unreadable credentials", (_description, encrypted) => {
    expect(() => decryptGitHubCredentials(Buffer.alloc(32), encrypted)).toThrow(
      "Cannot decrypt GitHub App credentials. Restore the configured encryption key.",
    )
  })
})
