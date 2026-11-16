import type { Prisma } from "../../../generated/prisma/client.ts"

/** Keeps repository and prototype visibility stable while recording a view. */
export async function lockVisiblePrototype(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  repositoryId: string,
  prototypeId: string,
) {
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    SELECT prototype."id"
    FROM "prototypes" prototype
    JOIN "repositories" repository ON repository."id" = prototype."repository_id"
    WHERE prototype."id" = ${prototypeId}::uuid
      AND prototype."repository_id" = ${repositoryId}::uuid
      AND repository."removed_at" IS NULL
      AND NOT prototype."replica"
      AND prototype."branch_name" NOT IN (repository."default_branch", 'replica/install-workflow')
    FOR SHARE OF repository, prototype
  `
  return rows[0] ?? null
}
