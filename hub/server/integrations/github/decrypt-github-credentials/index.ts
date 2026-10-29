import { createDecipheriv } from "node:crypto"

import { credentialContext } from "#server/integrations/github/encrypt-github-credentials/constants"
import { validateGitHubCredentials } from "#server/integrations/github/validate-github-credentials"
import type { GitHubCredentials } from "#server/integrations/github/validate-github-credentials/types"

export function decryptGitHubCredentials(
  key: Buffer,
  encryptedCredentials: string | null,
): GitHubCredentials | null {
  if (encryptedCredentials === null) return null
  let parsedCredentials: unknown
  try {
    const data = Buffer.from(encryptedCredentials, "base64")
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12))
    decipher.setAAD(credentialContext)
    decipher.setAuthTag(data.subarray(12, 28))
    const plaintext = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()])
    parsedCredentials = JSON.parse(plaintext.toString("utf8"))
  } catch {
    throw new Error("Cannot decrypt GitHub App credentials. Restore the configured encryption key.")
  }
  return validateGitHubCredentials(parsedCredentials)
}
