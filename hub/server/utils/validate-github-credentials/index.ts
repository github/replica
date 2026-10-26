import { createPrivateKey } from "node:crypto"
import { z } from "zod"

import type { GitHubCredentials } from "../identity-contracts/types.ts"
import { IdentityError } from "../identity-error/index.ts"

const schema = z
  .object({
    appId: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(30),
    clientId: z.string().min(1).max(200),
    clientSecret: z.string().min(1).max(1000),
    privateKey: z.string().min(1).max(16384),
  })
  .strict()

export function validateGitHubCredentials(input: unknown): GitHubCredentials {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new IdentityError(
      400,
      "invalid_credentials",
      "Supply the GitHub App ID, client ID, client secret, and RSA private key.",
    )
  }

  try {
    const key = createPrivateKey(parsed.data.privateKey)
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error("Invalid key")
    }
  } catch {
    throw new IdentityError(
      400,
      "invalid_credentials",
      "The GitHub App private key must be an RSA key of at least 2048 bits.",
    )
  }

  return parsed.data
}
