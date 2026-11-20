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
  const providers = await database.$queryRaw<
    Array<{ enabled: boolean; key: string; selectedRevisionId: string | null }>
  >`
    SELECT "enabled", "key", "selected_revision_id" AS "selectedRevisionId"
    FROM "authentication_providers"
    WHERE "key" IN ('github', 'local')
    ORDER BY "key"
    FOR SHARE
  `
  const githubProvider = providers.find(({ key }) => key === "github")
  const localProvider = providers.find(({ key }) => key === "local")

  const [membership] = await database.$queryRaw<Array<{ lifecycle: string }>>`
    SELECT "lifecycle"::text
    FROM "memberships"
    WHERE "id" = ${input.membershipId}::uuid
    FOR SHARE
  `
  if (membership?.lifecycle !== "ACTIVE") return false

  const [localIdentity] = await database.$queryRaw<Array<{ id: string }>>`
    SELECT external_identities."id"
    FROM "external_identities"
    JOIN "memberships"
      ON memberships."user_id" = external_identities."user_id"
    WHERE memberships."id" = ${input.membershipId}::uuid
      AND external_identities."provider" = 'local'
      AND external_identities."issuer" = 'local'
      AND external_identities."subject" = 'local-developer'
    FOR SHARE OF external_identities
  `

  const [repository] = await database.$queryRaw<
    Array<{ githubRepositoryId: bigint | null; localPath: string | null; removedAt: Date | null }>
  >`
    SELECT
      "github_repository_id" AS "githubRepositoryId",
      "local_path" AS "localPath",
      "removed_at" AS "removedAt"
    FROM "repositories"
    WHERE "id" = ${input.repositoryId}::uuid
    FOR SHARE
  `
  if (!repository || repository.removedAt !== null) return false

  const [grant] = await database.$queryRaw<Array<{ accessLevel: string }>>`
    SELECT "access_level"::text AS "accessLevel"
    FROM "repository_access_grants"
    WHERE "membership_id" = ${input.membershipId}::uuid
      AND "repository_id" = ${input.repositoryId}::uuid
    FOR SHARE
  `
  if (grant?.accessLevel !== "ADMIN") return false
  if (repository.localPath !== null) {
    return (
      repository.githubRepositoryId === null &&
      Boolean(localIdentity) &&
      Boolean(localProvider?.enabled && localProvider.selectedRevisionId)
    )
  }
  return (
    repository.githubRepositoryId !== null &&
    Boolean(githubProvider?.enabled && githubProvider.selectedRevisionId)
  )
}
