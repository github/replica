import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Rereads and locks a live Hub session together with its current repository
 * administrator evidence so a mutation has one fail-closed authorization point.
 */
export async function lockRepositoryAdministratorSession(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { membershipId: string; repositoryId: string; sessionDigest: string },
): Promise<boolean> {
  const rows = await database.$queryRaw<Array<{ authorized: boolean }>>`
    SELECT TRUE AS "authorized"
    FROM "hub_sessions" AS session
    INNER JOIN "memberships" AS membership
      ON membership."id" = session."membership_id"
    INNER JOIN "session_revocation_states" AS revocation
      ON revocation."key" = 'global'
    INNER JOIN "authentication_provider_revisions" AS session_revision
      ON session_revision."id" = session."provider_revision_id"
    INNER JOIN "authentication_providers" AS session_provider
      ON session_provider."id" = session_revision."provider_id"
    INNER JOIN "repository_access_grants" AS access_grant
      ON access_grant."membership_id" = membership."id"
    INNER JOIN "repositories" AS repository
      ON repository."id" = access_grant."repository_id"
    INNER JOIN "authentication_providers" AS github_provider
      ON github_provider."key" = 'github'
    WHERE session."digest" = ${input.sessionDigest}
      AND session."membership_id" = ${input.membershipId}::uuid
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
      AND session."revocation_revision" = revocation."revision"
      AND membership."lifecycle" = 'ACTIVE'::"MembershipLifecycle"
      AND session_provider."enabled" = TRUE
      AND session_provider."selected_revision_id" = session_revision."id"
      AND access_grant."repository_id" = ${input.repositoryId}::uuid
      AND access_grant."access_level" = 'ADMIN'::"RepositoryAccessLevel"
      AND repository."removed_at" IS NULL
      AND repository."github_repository_id" IS NOT NULL
      AND github_provider."enabled" = TRUE
      AND github_provider."selected_revision_id" IS NOT NULL
    FOR UPDATE OF session
    FOR SHARE OF membership, revocation, session_revision, session_provider,
      access_grant, repository, github_provider
  `
  return rows.length === 1
}
