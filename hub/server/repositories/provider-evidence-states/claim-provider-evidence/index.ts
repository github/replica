import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    externalIdentityId: z.uuid(),
    id: z.uuid(),
    issuedAt: z.date(),
    role: z.enum(["MEMBER", "ADMINISTRATOR"]).nullable(),
  })
  .strict()

function authorityRank(role: "MEMBER" | "ADMINISTRATOR" | null): number {
  if (role === "ADMINISTRATOR") return 2
  if (role === "MEMBER") return 1
  return 0
}

export async function claimProviderEvidence(
  database: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
  input: z.input<typeof inputSchema>,
): Promise<"advanced" | "conflict" | "created" | "stale"> {
  const parsed = inputSchema.parse(input)
  const existing = await database.$queryRaw<
    Array<{
      id: string
      lastIssuedAt: Date
      lastRole: "MEMBER" | "ADMINISTRATOR" | null
    }>
  >`
    SELECT "id", "last_issued_at" AS "lastIssuedAt", "last_role"::text AS "lastRole"
    FROM "provider_evidence_states"
    WHERE "external_identity_id" = ${parsed.externalIdentityId}::uuid
    FOR UPDATE
  `
  const state = existing[0]
  if (state) {
    const issuedAt = parsed.issuedAt.getTime()
    const lastIssuedAt = state.lastIssuedAt.getTime()
    const equalTimestampReduction =
      issuedAt === lastIssuedAt && authorityRank(parsed.role) < authorityRank(state.lastRole)
    if (issuedAt < lastIssuedAt || (issuedAt === lastIssuedAt && !equalTimestampReduction))
      return "stale"
    await database.$executeRaw`
      UPDATE "provider_evidence_states"
      SET
        "last_issued_at" = ${parsed.issuedAt},
        "last_role" = ${parsed.role}::"MembershipRole",
        "updated_at" = clock_timestamp()
      WHERE "id" = ${state.id}::uuid
    `
    return "advanced"
  }
  const created = await database.$executeRaw`
    INSERT INTO "provider_evidence_states" (
      "id", "external_identity_id", "last_issued_at", "last_role", "created_at", "updated_at"
    ) VALUES (
      ${parsed.id}::uuid,
      ${parsed.externalIdentityId}::uuid,
      ${parsed.issuedAt},
      ${parsed.role}::"MembershipRole",
      clock_timestamp(),
      clock_timestamp()
    )
    ON CONFLICT ("external_identity_id") DO NOTHING
  `
  return created === 1 ? "created" : "conflict"
}
