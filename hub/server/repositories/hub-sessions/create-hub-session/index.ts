import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createHubSession(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: {
    digest: string
    id: string
    lifetimeSeconds: number
    membershipId: string
    revocationRevision: number
    userId: string
  },
) {
  const rows = await database.$queryRaw<Array<{ expiresAt: Date }>>`
    INSERT INTO "hub_sessions" (
      "id", "user_id", "membership_id", "digest", "revocation_revision",
      "expires_at", "created_at", "updated_at"
    ) VALUES (
      ${input.id}::uuid,
      ${input.userId}::uuid,
      ${input.membershipId}::uuid,
      ${input.digest},
      ${input.revocationRevision},
      clock_timestamp() + make_interval(secs => ${input.lifetimeSeconds}),
      clock_timestamp(),
      clock_timestamp()
    )
    RETURNING "expires_at" AS "expiresAt"
  `
  return rows[0]!
}
