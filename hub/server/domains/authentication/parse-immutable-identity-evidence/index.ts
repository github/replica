import { z } from "zod"

import type { ImmutableIdentityEvidence } from "../types.ts"

const evidenceSchema = z
  .object({
    issuer: z.string().min(1).max(500),
    provider: z.string().min(1).max(100),
    subject: z.string().min(1).max(500),
  })
  .strict()

export function parseImmutableIdentityEvidence(input: unknown): ImmutableIdentityEvidence {
  const parsed = evidenceSchema.parse(input)
  return {
    provider: parsed.provider,
    issuer: parsed.issuer,
    subject: parsed.subject,
  }
}
