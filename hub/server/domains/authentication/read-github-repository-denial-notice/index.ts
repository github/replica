import { z } from "zod"

import { decryptAuthenticationValue } from "../decrypt-authentication-value/index.ts"

const noticeSchema = z
  .object({
    purpose: z.literal("github_repository_access_denial"),
    login: z.string().regex(/^[a-z0-9-]{1,39}$/i),
    expiresAt: z.number().int().positive(),
  })
  .strict()

export function readGitHubRepositoryDenialNotice(value: string, key: Buffer) {
  let decoded: unknown
  try {
    decoded = JSON.parse(decryptAuthenticationValue(value, key))
  } catch {
    return null
  }
  const notice = noticeSchema.safeParse(decoded)
  if (!notice.success || notice.data.expiresAt <= Date.now()) return null
  return { login: notice.data.login }
}
