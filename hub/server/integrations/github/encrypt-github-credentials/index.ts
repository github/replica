import { createCipheriv, randomBytes } from "node:crypto"

import { credentialContext } from "#server/integrations/github/encrypt-github-credentials/constants"
import type { GitHubCredentials } from "#server/integrations/github/validate-github-credentials/types"

export function encryptGitHubCredentials(key: Buffer, credentials: GitHubCredentials): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(credentialContext)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64")
}
