import { z } from "zod"

import { decryptAuthenticationValue } from "../../authentication/decrypt-authentication-value/index.ts"

const sessionSchema = z
  .object({
    v: z.literal(1),
    p: z.literal("session"),
    b: z.uuid(),
    s: z.uuid(),
    e: z.number().int().positive(),
  })
  .strict()

export function readSharePreviewSession(
  value: string,
  buildId: string,
  key: Buffer,
  now = new Date(),
) {
  try {
    const session = sessionSchema.parse(JSON.parse(decryptAuthenticationValue(value, key)))
    return session.b === buildId && session.e > now.getTime() ? session : null
  } catch {
    return null
  }
}
