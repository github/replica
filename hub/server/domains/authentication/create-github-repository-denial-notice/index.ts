import { z } from "zod"

import { encryptAuthenticationValue } from "../encrypt-authentication-value/index.ts"

const loginSchema = z.string().regex(/^[a-z0-9-]{1,39}$/i)

export function createGitHubRepositoryDenialNotice(login: string, key: Buffer) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1_000)
  const value = encryptAuthenticationValue(
    JSON.stringify({
      purpose: "github_repository_access_denial",
      login: loginSchema.parse(login),
      expiresAt: expiresAt.getTime(),
    }),
    key,
  )
  return { expiresAt, value }
}
