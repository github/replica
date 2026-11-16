import { z } from "zod"

import { decryptAuthenticationValue } from "../../authentication/decrypt-authentication-value/index.ts"

const grantSchema = z
  .object({
    v: z.literal(1),
    b: z.uuid(),
    t: z.enum(["preview", "desktop", "narrow"]),
    e: z.number().int().positive(),
  })
  .strict()

export function readPreviewGrant(value: string, key: Buffer, now = new Date()) {
  try {
    const grant = grantSchema.parse(JSON.parse(decryptAuthenticationValue(value, key)))
    if (grant.e <= now.getTime() || grant.e > now.getTime() + 60_000) return null
    return { buildId: grant.b, target: grant.t, expiresAt: new Date(grant.e) }
  } catch {
    return null
  }
}
