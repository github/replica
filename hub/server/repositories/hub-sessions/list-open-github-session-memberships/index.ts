import type { Prisma } from "../../../generated/prisma/client.ts"

export async function listOpenGitHubSessionMemberships(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  return database.$queryRaw<Array<{ membershipId: string }>>`
    SELECT DISTINCT session."membership_id" AS "membershipId"
    FROM "hub_sessions" session
    JOIN "external_identities" identity ON identity."id" = session."external_identity_id"
    WHERE identity."provider" = 'github'
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
    ORDER BY session."membership_id"
  `
}
