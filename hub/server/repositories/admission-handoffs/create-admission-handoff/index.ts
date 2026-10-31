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
    externalIdentityId: z.uuid(),
    id: z.uuid(),
    lifetimeSeconds: z.number().int().min(1).max(3_600),
    providerRevisionId: z.uuid(),
    revocationGeneration: z.bigint().positive(),
    tokenDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

export async function createAdmissionHandoff(
  database: CreateAdmissionHandoffDatabase,
  input: CreateAdmissionHandoffInput,
): Promise<{ createdAt: Date; expiresAt: Date }> {
  const parsed = inputSchema.parse(input)
  const rows = await database.$queryRaw<Array<{ created_at: Date; expires_at: Date }>>`
    INSERT INTO "admission_handoffs" (
      "id", "external_identity_id", "provider_revision_id", "token_digest",
      "browser_binding_digest", "revocation_generation", "display_attributes",
      "expires_at", "created_at", "updated_at"
    ) VALUES (
      ${parsed.id}::uuid,
      ${parsed.externalIdentityId}::uuid,
      ${parsed.providerRevisionId}::uuid,
      ${parsed.tokenDigest},
      ${parsed.browserBindingDigest},
      ${parsed.revocationGeneration},
      ${JSON.stringify(parsed.displayAttributes)}::jsonb,
      clock_timestamp() + make_interval(secs => ${parsed.lifetimeSeconds}),
      clock_timestamp(),
      clock_timestamp()
    )
    RETURNING "created_at", "expires_at"
  `
  return { createdAt: rows[0]!.created_at, expiresAt: rows[0]!.expires_at }
}
