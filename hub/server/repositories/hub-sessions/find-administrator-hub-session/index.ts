import type { Prisma } from "../../../generated/prisma/client.ts"

export async function findAdministratorHubSession(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  digest: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      externalIdentityId: string
      id: string
      membershipId: string
      providerKey: string
      providerRevisionId: string
    }>
  >`
    SELECT
      session."id",
      session."membership_id" AS "membershipId",
      session."external_identity_id" AS "externalIdentityId",
      session."provider_revision_id" AS "providerRevisionId",
      provider."key" AS "providerKey"
    FROM "hub_sessions" session
    JOIN "memberships" membership ON membership."id" = session."membership_id"
    JOIN "authentication_provider_revisions" revision
      ON revision."id" = session."provider_revision_id"
    JOIN "authentication_providers" provider ON provider."id" = revision."provider_id"
    JOIN "session_revocation_states" revocation ON revocation."key" = 'global'
    WHERE session."digest" = ${digest}
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
      AND session."revocation_revision" = revocation."revision"
      AND membership."lifecycle" = 'ACTIVE'
      AND provider."enabled" = true
      AND provider."selected_revision_id" = revision."id"
      AND EXISTS (
        SELECT 1
        FROM "membership_assignments" assignment
        LEFT JOIN "authentication_provider_revisions" assignment_revision
          ON assignment_revision."id" = assignment."provider_revision_id"
        LEFT JOIN "authentication_providers" assignment_provider
          ON assignment_provider."id" = assignment_revision."provider_id"
        WHERE assignment."membership_id" = membership."id"
          AND assignment."lifecycle" = 'ACTIVE'
          AND assignment."role" = 'ADMINISTRATOR'
          AND (
            assignment."source" IN ('BOOTSTRAP', 'HUB_ADMINISTRATOR')
            OR (
              assignment."source" = 'AUTHENTICATION_PROVIDER'
              AND assignment_provider."enabled" = true
              AND assignment_provider."selected_revision_id" = assignment."provider_revision_id"
            )
          )
      )
  `
  return rows[0] ?? null
}
