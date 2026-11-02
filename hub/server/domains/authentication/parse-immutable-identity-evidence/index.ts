import { z } from "zod"

import type { ImmutableIdentityEvidence } from "../types.ts"

const evidenceSchema = z
  .object({
    attributes: z
      .object({
        avatarUrl: z
          .url()
          .max(2_000)
          .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
          .nullable()
          .optional(),
        email: z.email().max(320).nullable().optional(),
        name: z.string().min(1).max(200).nullable().optional(),
        preferredUsername: z.string().min(1).max(200).nullable().optional(),
      })
      .strict()
      .optional(),
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
    attributes: {
      avatarUrl: parsed.attributes?.avatarUrl ?? null,
      email: parsed.attributes?.email ?? null,
      name: parsed.attributes?.name ?? null,
      preferredUsername: parsed.attributes?.preferredUsername ?? null,
    },
  }
}
