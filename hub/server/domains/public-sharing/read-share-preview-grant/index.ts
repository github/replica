import { z } from "zod"

import { decryptAuthenticationValue } from "../../authentication/decrypt-authentication-value/index.ts"

const grantSchema = z
  .object({
    v: z.literal(1),
    p: z.literal("grant"),
    b: z.uuid(),
    s: z.uuid(),
    e: z.number().int().positive(),
  })
  .strict()

export function readSharePreviewGrant(value: string, key: Buffer, now = new Date()) {
  try {
    const grant = grantSchema.parse(JSON.parse(decryptAuthenticationValue(value, key)))
    return grant.e > now.getTime() ? grant : null
  } catch {
    return null
  }
}
