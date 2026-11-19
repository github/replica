import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Locks a prototype that the detail page would show. The shared repository
 * lock keeps its removal and default branch fixed until the edit commits.
 */
export async function lockEditablePrototype(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  repositoryId: string,
  prototypeId: string,
) {
  const rows = await database.$queryRaw<
    Array<{
      id: string
      name: string | null
      branchName: string
      registeredAt: Date | null
      hosted: boolean
    }>
  >`
    SELECT
      prototype."id",
      prototype."name",
      prototype."branch_name" AS "branchName",
      prototype."registered_at" AS "registeredAt",
      (repository."github_repository_id" IS NOT NULL AND repository."local_path" IS NULL) AS "hosted"
    FROM "prototypes" prototype
    JOIN "repositories" repository ON repository."id" = prototype."repository_id"
    WHERE prototype."id" = ${prototypeId}::uuid
      AND prototype."repository_id" = ${repositoryId}::uuid
      AND repository."removed_at" IS NULL
      AND NOT prototype."replica"
      AND (
        prototype."registered_at" IS NOT NULL
        OR prototype."branch_deleted_at" IS NULL
        OR repository."github_repository_id" IS NULL
        OR repository."local_path" IS NOT NULL
      )
      AND prototype."branch_name" NOT IN (repository."default_branch", 'replica/install-workflow')
    FOR SHARE OF repository
    FOR UPDATE OF prototype
  `
  return rows[0] ?? null
}
