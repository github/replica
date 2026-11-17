import { randomUUID } from "node:crypto"

import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Records role-less provider evidence for many identities at once. Mirrors
 * `claimProviderEvidence` with a null role: existing states must advance, and
 * a concurrent insert of a missing state is reported as a conflict.
 */
export async function claimProviderRevocationEvidence(
  database: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
  input: { externalIdentityIds: string[]; issuedAt: Date },
): Promise<"claimed" | "conflict" | "stale"> {
  const identityIds = [...new Set(input.externalIdentityIds)]
  if (!identityIds.length) return "claimed"
  const existing = await database.$queryRaw<
    Array<{ externalIdentityId: string; lastIssuedAt: Date; lastRole: string | null }>
  >`
    SELECT
      "external_identity_id" AS "externalIdentityId",
      "last_issued_at" AS "lastIssuedAt",
      "last_role"::text AS "lastRole"
    FROM "provider_evidence_states"
    WHERE "external_identity_id" = ANY(${identityIds}::uuid[])
    ORDER BY "external_identity_id"
    FOR UPDATE
  `
  const issuedAt = input.issuedAt.getTime()
  const advances = existing.every(
    (state) =>
      issuedAt > state.lastIssuedAt.getTime() ||
      (issuedAt === state.lastIssuedAt.getTime() && state.lastRole !== null),
  )
  if (!advances) return "stale"
  if (existing.length) {
    await database.$executeRaw`
      UPDATE "provider_evidence_states"
      SET
        "last_issued_at" = ${input.issuedAt},
        "last_role" = NULL,
        "updated_at" = GREATEST(clock_timestamp(), "updated_at" + interval '1 millisecond')
      WHERE "external_identity_id" = ANY(${existing.map((state) => state.externalIdentityId)}::uuid[])
    `
  }
  const known = new Set(existing.map((state) => state.externalIdentityId))
  const missing = identityIds.filter((id) => !known.has(id))
  if (!missing.length) return "claimed"
  const created = await database.$executeRaw`
    INSERT INTO "provider_evidence_states" (
      "id", "external_identity_id", "last_issued_at", "last_role", "created_at", "updated_at"
    )
    SELECT state."id", state."external_identity_id", ${input.issuedAt}, NULL, clock_timestamp(), clock_timestamp()
    FROM unnest(
      ${missing.map(() => randomUUID())}::uuid[],
      ${missing}::uuid[]
    ) AS state("id", "external_identity_id")
    ON CONFLICT ("external_identity_id") DO NOTHING
  `
  return created === missing.length ? "claimed" : "conflict"
}
