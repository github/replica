import type { Prisma } from "../../../generated/prisma/client.ts"

export async function verifySensitiveAuthorization(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: {
    authorizationAttemptId: string
    externalIdentityId: string
    sessionDigest: string
    sensitiveAuthorizationId: string
  },
) {
  const rows = await database.$queryRaw<
    Array<{
      actorMembershipId: string
      id: string
      operation: "DESIGNATE_ADMINISTRATORS" | "REVOKE_ADMINISTRATOR"
      targetCount: number
    }>
  >`
    UPDATE "sensitive_authorizations" authorization
    SET "verified_at" = clock_timestamp(), "updated_at" = clock_timestamp()
    FROM
      "authorization_attempts" attempt,
      "hub_sessions" session,
      "memberships" membership,
      "session_revocation_states" revocation,
      "authentication_provider_revisions" revision,
      "authentication_providers" provider
    WHERE authorization."id" = ${input.sensitiveAuthorizationId}::uuid
      AND attempt."id" = ${input.authorizationAttemptId}::uuid
      AND attempt."sensitive_authorization_id" = authorization."id"
      AND attempt."purpose" = 'ADMINISTRATOR_MANAGEMENT'
      AND attempt."consumed_at" IS NOT NULL
      AND attempt."provider_revision_id" = session."provider_revision_id"
      AND authorization."external_identity_id" = ${input.externalIdentityId}::uuid
      AND session."id" = authorization."hub_session_id"
      AND session."digest" = ${input.sessionDigest}
      AND session."external_identity_id" = authorization."external_identity_id"
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
      AND revocation."key" = 'global'
      AND session."revocation_revision" = revocation."revision"
      AND revision."id" = session."provider_revision_id"
      AND provider."id" = revision."provider_id"
      AND provider."enabled" = true
      AND provider."selected_revision_id" = revision."id"
      AND membership."id" = authorization."actor_membership_id"
      AND membership."lifecycle" = 'ACTIVE'
      AND authorization."expires_at" > clock_timestamp()
      AND authorization."verified_at" IS NULL
      AND authorization."continued_at" IS NULL
      AND authorization."cancelled_at" IS NULL
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
      authorization."id",
      authorization."actor_membership_id" AS "actorMembershipId",
      authorization."operation",
      cardinality(authorization."target_membership_ids") AS "targetCount"
  `
  return rows[0] ?? null
}
