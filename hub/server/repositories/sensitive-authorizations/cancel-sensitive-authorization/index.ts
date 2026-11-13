import type { Prisma } from "../../../generated/prisma/client.ts"

export async function cancelSensitiveAuthorization(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { id: string; hubSessionId: string },
) {
  const rows = await database.$queryRaw<
    Array<{
      actorMembershipId: string
      id: string
      operation: "DESIGNATE_ADMINISTRATORS" | "END_ALL_HUB_SESSIONS" | "REVOKE_ADMINISTRATOR"
      targetCount: number
    }>
  >`
    UPDATE "sensitive_authorizations"
    SET "cancelled_at" = clock_timestamp(), "updated_at" = clock_timestamp()
    FROM
      "hub_sessions" session,
      "memberships" membership,
      "session_revocation_states" revocation,
      "authentication_provider_revisions" revision,
      "authentication_providers" provider
    WHERE "sensitive_authorizations"."id" = ${input.id}::uuid
      AND "sensitive_authorizations"."hub_session_id" = ${input.hubSessionId}::uuid
      AND session."id" = "sensitive_authorizations"."hub_session_id"
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
      AND revocation."key" = 'global'
      AND session."revocation_revision" = revocation."revision"
      AND membership."id" = "sensitive_authorizations"."actor_membership_id"
      AND membership."lifecycle" = 'ACTIVE'
      AND revision."id" = session."provider_revision_id"
      AND provider."id" = revision."provider_id"
      AND provider."enabled" = true
      AND provider."selected_revision_id" = revision."id"
      AND "sensitive_authorizations"."continued_at" IS NULL
      AND "sensitive_authorizations"."cancelled_at" IS NULL
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
    RETURNING
      "sensitive_authorizations"."id",
      "sensitive_authorizations"."actor_membership_id" AS "actorMembershipId",
      "sensitive_authorizations"."operation",
      cardinality("sensitive_authorizations"."target_membership_ids") AS "targetCount"
  `
  return rows[0] ?? null
}
