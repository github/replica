import { z } from "zod"

import { decryptAuthenticationValue } from "../../authentication/decrypt-authentication-value/index.ts"

const sessionSchema = z
  .object({
    v: z.literal(1),
    b: z.uuid(),
    s: z.string().regex(/^[a-f0-9]{64}$/),
    e: z.number().int().positive(),
    t: z.literal(true).optional(),
  })
  .strict()

export function readPreviewSession(value: string, buildId: string, key: Buffer, now = new Date()) {
  try {
    const session = sessionSchema.parse(JSON.parse(decryptAuthenticationValue(value, key)))
    return session.b === buildId && session.e > now.getTime() ? session : null
  } catch {
    return null
  }
}
