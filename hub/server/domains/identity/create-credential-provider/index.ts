import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import type { CredentialProvider } from "../../../utils/identity-contracts/types.ts"
import { validateGitHubCredentials } from "../../../utils/validate-github-credentials/index.ts"

export function createCredentialProvider(environment: NodeJS.ProcessEnv): CredentialProvider {
  const selected = environment.HUB_CREDENTIAL_PROVIDER ?? "database"
  if (selected === "environment") {
    const credentials = validateGitHubCredentials({
      appId: environment.GITHUB_APP_ID,
      clientId: environment.GITHUB_CLIENT_ID,
      clientSecret: environment.GITHUB_CLIENT_SECRET,
      privateKey: environment.GITHUB_PRIVATE_KEY,
    })
    return { name: "environment", read: () => credentials }
  }
  if (selected !== "database") {
    throw new Error("HUB_CREDENTIAL_PROVIDER must be database or environment.")
  }

  const encodedKey = environment.HUB_CREDENTIAL_KEY
  if (!encodedKey || !/^[a-fA-F0-9]{64}$/.test(encodedKey)) {
    throw new Error(
      "Set HUB_CREDENTIAL_KEY to a 32-byte hexadecimal encryption key outside the database.",
    )
  }
  const key = Buffer.from(encodedKey, "hex")

  return {
    name: "database",
    read(state) {
      if (state.encryptedCredentials === null) return null
      try {
        const data = Buffer.from(state.encryptedCredentials, "base64")
        const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12))
        decipher.setAAD(Buffer.from("replica:github-app:v1"))
        decipher.setAuthTag(data.subarray(12, 28))
        const plaintext = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()])
        return validateGitHubCredentials(JSON.parse(plaintext.toString("utf8")))
      } catch {
        throw new Error(
          "Cannot decrypt GitHub App credentials. Restore the configured encryption key.",
        )
      }
    },
    encrypt(credentials) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", key, nonce)
      cipher.setAAD(Buffer.from("replica:github-app:v1"))
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64")
    },
  }
}
