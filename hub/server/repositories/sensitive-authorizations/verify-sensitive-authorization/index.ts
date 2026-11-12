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
      operation:
        | "CONNECT_COPILOT"
        | "DESIGNATE_ADMINISTRATORS"
        | "DISCONNECT_COPILOT"
        | "END_ALL_HUB_SESSIONS"
        | "REVOKE_ADMINISTRATOR"
      targetCount: number
    }>
  >`
    UPDATE "sensitive_authorizations" sensitive_authorization
    SET "verified_at" = clock_timestamp(), "updated_at" = clock_timestamp()
    FROM
      "authorization_attempts" attempt,
      "hub_sessions" session,
      "memberships" membership,
      "session_revocation_states" revocation,
      "authentication_provider_revisions" revision,
      "authentication_providers" provider
    WHERE sensitive_authorization."id" = ${input.sensitiveAuthorizationId}::uuid
      AND attempt."id" = ${input.authorizationAttemptId}::uuid
      AND attempt."sensitive_authorization_id" = sensitive_authorization."id"
      AND attempt."purpose" = 'ADMINISTRATOR_MANAGEMENT'
      AND attempt."consumed_at" IS NOT NULL
      AND attempt."provider_revision_id" = session."provider_revision_id"
      AND sensitive_authorization."external_identity_id" = ${input.externalIdentityId}::uuid
      AND session."id" = sensitive_authorization."hub_session_id"
      AND session."digest" = ${input.sessionDigest}
      AND session."external_identity_id" = sensitive_authorization."external_identity_id"
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
      AND revocation."key" = 'global'
      AND session."revocation_revision" = revocation."revision"
      AND revision."id" = session."provider_revision_id"
      AND provider."id" = revision."provider_id"
      AND provider."enabled" = true
      AND provider."selected_revision_id" = revision."id"
      AND membership."id" = sensitive_authorization."actor_membership_id"
      AND membership."lifecycle" = 'ACTIVE'
      AND sensitive_authorization."expires_at" > clock_timestamp()
      AND sensitive_authorization."verified_at" IS NULL
      AND sensitive_authorization."continued_at" IS NULL
      AND sensitive_authorization."cancelled_at" IS NULL
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
      sensitive_authorization."id",
      sensitive_authorization."actor_membership_id" AS "actorMembershipId",
      sensitive_authorization."operation",
      cardinality(sensitive_authorization."target_membership_ids") AS "targetCount"
  `
  return rows[0] ?? null
}
