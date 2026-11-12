import { z } from "zod"

import type { Prisma } from "../../../generated/prisma/client.ts"

const inputSchema = z
  .object({
    actorMembershipId: z.uuid(),
    externalIdentityId: z.uuid(),
    hubSessionId: z.uuid(),
    id: z.uuid(),
    lifetimeSeconds: z.number().int().min(60).max(600),
    operation: z.enum(["DESIGNATE_ADMINISTRATORS", "REVOKE_ADMINISTRATOR"]),
    targetMembershipIds: z.array(z.uuid()).min(1).max(50),
  })
  .strict()

export async function createSensitiveAuthorization(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: z.input<typeof inputSchema>,
): Promise<{ expiresAt: Date } | null> {
  const parsed = inputSchema.parse(input)
  const rows = await database.$queryRaw<Array<{ expiresAt: Date }>>`
    INSERT INTO "sensitive_authorizations" (
      "id", "hub_session_id", "actor_membership_id", "external_identity_id",
      "operation", "target_membership_ids", "expires_at", "created_at", "updated_at"
    )
    SELECT
      ${parsed.id}::uuid,
      session."id",
      membership."id",
      session."external_identity_id",
      ${parsed.operation}::"SensitiveAuthorizationOperation",
      ${parsed.targetMembershipIds}::uuid[],
      clock_timestamp() + make_interval(secs => ${parsed.lifetimeSeconds}),
      clock_timestamp(),
      clock_timestamp()
    FROM "hub_sessions" session
    JOIN "memberships" membership ON membership."id" = session."membership_id"
    JOIN "session_revocation_states" revocation ON revocation."key" = 'global'
    JOIN "authentication_provider_revisions" revision
      ON revision."id" = session."provider_revision_id"
    JOIN "authentication_providers" provider ON provider."id" = revision."provider_id"
    WHERE session."id" = ${parsed.hubSessionId}::uuid
      AND membership."id" = ${parsed.actorMembershipId}::uuid
      AND session."external_identity_id" = ${parsed.externalIdentityId}::uuid
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
    RETURNING "expires_at" AS "expiresAt"
  `
  return rows[0] ?? null
}
