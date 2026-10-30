import { z } from "zod"

import type { CreateAdmissionHandoffDatabase, CreateAdmissionHandoffInput } from "./types.ts"

const inputSchema = z
  .object({
    browserBindingDigest: z.string().regex(/^[0-9a-f]{64}$/),
    displayAttributes: z
      .object({
        avatarUrl: z.url().max(2_000).nullable(),
        email: z.email().max(320).nullable(),
        login: z.string().min(1).max(100),
        name: z.string().min(1).max(200).nullable(),
      })
      .strict(),
    expiresAt: z.date(),
    externalIdentityId: z.uuid(),
    id: z.uuid(),
    providerRevisionId: z.uuid(),
    revocationGeneration: z.bigint().positive(),
    tokenDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

export function createAdmissionHandoff(
  database: CreateAdmissionHandoffDatabase,
  input: CreateAdmissionHandoffInput,
) {
  return database.admissionHandoff.create({ data: inputSchema.parse(input) })
}
