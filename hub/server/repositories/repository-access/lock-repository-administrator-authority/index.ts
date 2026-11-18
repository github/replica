import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Locks every durable row that can remove repository-administrator authority.
 * Authority-changing transactions must update or delete one of these rows, so a
 * mutation authorized in the same transaction cannot race a concurrent revocation.
 */
export async function lockRepositoryAdministratorAuthority(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { membershipId: string; repositoryId: string },
): Promise<boolean> {
  const rows = await database.$queryRaw<Array<{ authorized: boolean }>>`
    SELECT TRUE AS "authorized"
    FROM "repository_access_grants" AS access_grant
    INNER JOIN "memberships" AS membership
      ON membership."id" = access_grant."membership_id"
    INNER JOIN "repositories" AS repository
      ON repository."id" = access_grant."repository_id"
    INNER JOIN "authentication_providers" AS provider
      ON provider."key" = 'github'
    WHERE access_grant."membership_id" = ${input.membershipId}::uuid
      AND access_grant."repository_id" = ${input.repositoryId}::uuid
      AND access_grant."access_level" = 'ADMIN'::"RepositoryAccessLevel"
      AND membership."lifecycle" = 'ACTIVE'::"MembershipLifecycle"
      AND repository."removed_at" IS NULL
      AND repository."github_repository_id" IS NOT NULL
      AND provider."enabled" = TRUE
      AND provider."selected_revision_id" IS NOT NULL
    FOR SHARE OF access_grant, membership, repository, provider
  `
  return rows.length === 1
}
