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
  const [provider] = await database.$queryRaw<
    Array<{ enabled: boolean; selectedRevisionId: string | null }>
  >`
    SELECT "enabled", "selected_revision_id" AS "selectedRevisionId"
    FROM "authentication_providers"
    WHERE "key" = 'github'
    FOR SHARE
  `
  if (!provider?.enabled || !provider.selectedRevisionId) return false

  const [membership] = await database.$queryRaw<Array<{ lifecycle: string }>>`
    SELECT "lifecycle"::text
    FROM "memberships"
    WHERE "id" = ${input.membershipId}::uuid
    FOR SHARE
  `
  if (membership?.lifecycle !== "ACTIVE") return false

  const [repository] = await database.$queryRaw<
    Array<{ githubRepositoryId: bigint | null; removedAt: Date | null }>
  >`
    SELECT
      "github_repository_id" AS "githubRepositoryId",
      "removed_at" AS "removedAt"
    FROM "repositories"
    WHERE "id" = ${input.repositoryId}::uuid
    FOR SHARE
  `
  if (repository?.removedAt !== null || repository.githubRepositoryId === null) return false

  const [grant] = await database.$queryRaw<Array<{ accessLevel: string }>>`
    SELECT "access_level"::text AS "accessLevel"
    FROM "repository_access_grants"
    WHERE "membership_id" = ${input.membershipId}::uuid
      AND "repository_id" = ${input.repositoryId}::uuid
    FOR SHARE
  `
  return grant?.accessLevel === "ADMIN"
}
