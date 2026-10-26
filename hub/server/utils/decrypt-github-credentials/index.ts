import { createDecipheriv } from "node:crypto"

import { credentialContext } from "#server/utils/encrypt-github-credentials/constants"
import type { GitHubCredentials, IdentityState } from "#server/utils/identity-contracts/types"
import { validateGitHubCredentials } from "#server/utils/validate-github-credentials"

export function decryptGitHubCredentials(
  key: Buffer,
  state: IdentityState,
): GitHubCredentials | null {
  if (state.encryptedCredentials === null) return null
  try {
    const data = Buffer.from(state.encryptedCredentials, "base64")
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12))
    decipher.setAAD(credentialContext)
    decipher.setAuthTag(data.subarray(12, 28))
    const plaintext = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()])
    return validateGitHubCredentials(JSON.parse(plaintext.toString("utf8")))
  } catch {
    throw new Error("Cannot decrypt GitHub App credentials. Restore the configured encryption key.")
  }
}
