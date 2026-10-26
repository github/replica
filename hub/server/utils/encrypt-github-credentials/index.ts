import { createCipheriv, randomBytes } from "node:crypto"

import type { GitHubCredentials } from "#server/utils/identity-contracts/types"

import { credentialContext } from "./constants.ts"

export function encryptGitHubCredentials(key: Buffer, credentials: GitHubCredentials): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(credentialContext)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64")
}
