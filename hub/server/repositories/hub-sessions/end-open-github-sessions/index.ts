import type { Prisma } from "../../../generated/prisma/client.ts"

export async function endOpenGitHubSessions(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  membershipIds: string[],
) {
  if (!membershipIds.length) return []
  return database.$queryRaw<Array<{ id: string; membershipId: string }>>`
    UPDATE "hub_sessions" session
    SET
      "ended_at" = clock_timestamp(),
      "end_reason" = NULL,
      "updated_at" = clock_timestamp()
    FROM "external_identities" identity
    WHERE identity."id" = session."external_identity_id"
      AND identity."provider" = 'github'
      AND session."membership_id" = ANY(${membershipIds}::uuid[])
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
    RETURNING session."id", session."membership_id" AS "membershipId"
  `
}
