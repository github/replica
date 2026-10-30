import type { ConsumeAdmissionHandoffDatabase, ConsumeAdmissionHandoffResult } from "./types.ts"

export async function consumeAdmissionHandoff(
  database: ConsumeAdmissionHandoffDatabase,
  input: { browserBindingDigest: string; id: string },
): Promise<ConsumeAdmissionHandoffResult> {
  const locked = await database.$queryRaw<
    Array<{ browser_binding_digest: string; consumed_at: Date | null }>
  >`
    SELECT "browser_binding_digest", "consumed_at"
    FROM "admission_handoffs"
    WHERE "id" = ${input.id}::uuid
    FOR UPDATE
  `
  const handoff = locked[0]
  if (!handoff || handoff.consumed_at) return "replayed"
  if (handoff.browser_binding_digest !== input.browserBindingDigest) {
    return "browser_mismatch"
  }
  const consumed = await database.$queryRaw<Array<{ id: string }>>`
    UPDATE "admission_handoffs"
    SET "consumed_at" = clock_timestamp(), "updated_at" = clock_timestamp()
    WHERE "id" = ${input.id}::uuid
      AND "consumed_at" IS NULL
      AND "expires_at" > clock_timestamp()
    RETURNING "id"
  `
  return consumed.length === 1 ? "consumed" : "expired"
}
