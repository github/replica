import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockAdministratorHubSession(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  digest: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      externalIdentityId: string
      id: string
      membershipId: string
      providerKey: string
    }>
  >`
    SELECT DISTINCT
      session."id",
      session."membership_id" AS "membershipId",
      session."external_identity_id" AS "externalIdentityId",
      session_provider."key" AS "providerKey"
    FROM "hub_sessions" session
    JOIN "memberships" membership ON membership."id" = session."membership_id"
    JOIN "session_revocation_states" revocation ON revocation."key" = 'global'
    JOIN "authentication_provider_revisions" session_revision
      ON session_revision."id" = session."provider_revision_id"
    JOIN "authentication_providers" session_provider
      ON session_provider."id" = session_revision."provider_id"
    JOIN "membership_assignments" assignment
      ON assignment."membership_id" = membership."id"
    WHERE session."digest" = ${digest}
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
      AND session."revocation_revision" = revocation."revision"
      AND membership."lifecycle" = 'ACTIVE'
      AND session_provider."enabled" = true
      AND session_provider."selected_revision_id" = session_revision."id"
      AND assignment."lifecycle" = 'ACTIVE'
      AND assignment."role" = 'ADMINISTRATOR'
      AND (
        assignment."source" IN ('BOOTSTRAP', 'HUB_ADMINISTRATOR')
        OR (
          assignment."source" = 'AUTHENTICATION_PROVIDER'
          AND EXISTS (
            SELECT 1
            FROM "authentication_provider_revisions" assignment_revision
            JOIN "authentication_providers" assignment_provider
              ON assignment_provider."id" = assignment_revision."provider_id"
            WHERE assignment_revision."id" = assignment."provider_revision_id"
              AND assignment_provider."enabled" = true
              AND assignment_provider."selected_revision_id" = assignment."provider_revision_id"
            FOR SHARE OF assignment_revision, assignment_provider
          )
        )
      )
    FOR UPDATE OF session, membership, assignment
    FOR SHARE OF revocation, session_revision, session_provider
  `
  return rows[0] ?? null
}
