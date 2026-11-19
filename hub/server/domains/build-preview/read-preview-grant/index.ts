import { z } from "zod"

import { decryptAuthenticationValue } from "../../authentication/decrypt-authentication-value/index.ts"
import { isTemplateScreenshotPath } from "../template-screenshot-path/index.ts"

const grantSchema = z
  .object({
    v: z.literal(1),
    b: z.uuid(),
    t: z.enum(["preview", "desktop", "narrow", "template"]),
    p: z.string().refine(isTemplateScreenshotPath).optional(),
    e: z.number().int().positive(),
    s: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine(({ p, t }) => p === undefined || t === "template")

export function readPreviewGrant(value: string, key: Buffer, now = new Date()) {
  try {
    const grant = grantSchema.parse(JSON.parse(decryptAuthenticationValue(value, key)))
    if (grant.e <= now.getTime() || grant.e > now.getTime() + 60_000) return null
    return {
      buildId: grant.b,
      target: grant.t,
      ...(grant.p ? { screenshotPath: grant.p } : {}),
      expiresAt: new Date(grant.e),
      sessionDigest: grant.s,
    }
  } catch {
    return null
  }
}
