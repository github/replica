import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getSensitiveAuthorization(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { hubSessionId: string; id: string },
) {
  const rows = await database.$queryRaw<
    Array<{
      expiresAt: Date
      login: string | null
      membershipId: string
      name: string | null
      operation: "DESIGNATE_ADMINISTRATORS" | "REVOKE_ADMINISTRATOR"
      provider: string | null
      verifiedAt: Date
    }>
  >`
    SELECT
      sensitive_authorization."operation",
      sensitive_authorization."expires_at" AS "expiresAt",
      sensitive_authorization."verified_at" AS "verifiedAt",
      target."membershipId",
      target."provider",
      target."login",
      target."name"
    FROM "sensitive_authorizations" sensitive_authorization
    JOIN "hub_sessions" session ON session."id" = sensitive_authorization."hub_session_id"
    JOIN "memberships" actor ON actor."id" = sensitive_authorization."actor_membership_id"
    JOIN "session_revocation_states" revocation ON revocation."key" = 'global'
    JOIN "authentication_provider_revisions" revision
      ON revision."id" = session."provider_revision_id"
    JOIN "authentication_providers" provider ON provider."id" = revision."provider_id"
    JOIN LATERAL (
      SELECT
        membership."id" AS "membershipId",
        profile."provider",
        profile."login",
        profile."name"
      FROM unnest(sensitive_authorization."target_membership_ids")
        WITH ORDINALITY selected("id", "position")
      JOIN "memberships" membership ON membership."id" = selected."id"
      LEFT JOIN "user_profiles" profile ON profile."user_id" = membership."user_id"
      ORDER BY selected."position"
    ) target ON true
    WHERE sensitive_authorization."id" = ${input.id}::uuid
      AND sensitive_authorization."hub_session_id" = ${input.hubSessionId}::uuid
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
      AND session."revocation_revision" = revocation."revision"
      AND actor."lifecycle" = 'ACTIVE'
      AND provider."enabled" = true
      AND provider."selected_revision_id" = revision."id"
      AND sensitive_authorization."expires_at" > clock_timestamp()
      AND sensitive_authorization."verified_at" IS NOT NULL
      AND sensitive_authorization."continued_at" IS NULL
      AND sensitive_authorization."cancelled_at" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "membership_assignments" assignment
        LEFT JOIN "authentication_provider_revisions" assignment_revision
          ON assignment_revision."id" = assignment."provider_revision_id"
        LEFT JOIN "authentication_providers" assignment_provider
          ON assignment_provider."id" = assignment_revision."provider_id"
        WHERE assignment."membership_id" = actor."id"
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
  const first = rows[0]
  return first
    ? {
        expiresAt: first.expiresAt,
        operation: first.operation,
        targets: rows.map(({ login, membershipId, name, provider }) => ({
          login,
          membershipId,
          name,
          provider,
        })),
        verifiedAt: first.verifiedAt,
      }
    : null
}
