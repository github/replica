import type { ConsumeAdmissionHandoffDatabase, ConsumeAdmissionHandoffResult } from "./types.ts"

export async function consumeAdmissionHandoff(
  database: ConsumeAdmissionHandoffDatabase,
  input: { browserBindingDigest: string; id: string },
): Promise<ConsumeAdmissionHandoffResult> {
  const rows = await database.$queryRaw<Array<{ status: ConsumeAdmissionHandoffResult }>>`
    WITH current_handoff AS (
      SELECT "id", "browser_binding_digest", "consumed_at", "expires_at"
      FROM "admission_handoffs"
      WHERE "id" = ${input.id}::uuid
      FOR UPDATE
    ),
    consumed AS (
      UPDATE "admission_handoffs"
      SET "consumed_at" = clock_timestamp(), "updated_at" = clock_timestamp()
      WHERE "id" = ${input.id}::uuid
        AND "consumed_at" IS NULL
        AND "browser_binding_digest" = ${input.browserBindingDigest}
        AND "expires_at" > clock_timestamp()
      RETURNING "id"
    )
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM consumed) THEN 'consumed'
      WHEN (SELECT "consumed_at" FROM current_handoff) IS NOT NULL THEN 'replayed'
      WHEN (SELECT "browser_binding_digest" FROM current_handoff)
        <> ${input.browserBindingDigest} THEN 'browser_mismatch'
      ELSE 'expired'
    END AS "status"
  `
  return rows[0]?.status ?? "replayed"
}
