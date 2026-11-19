import type { Prisma } from "../../../generated/prisma/client.ts"

/** Keeps repository eligibility and saved metadata fixed through registration. */
export async function lockImportedPrototype(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  buildId: string,
) {
  const rows = await database.$queryRaw<
    Array<{ id: string; branchName: string; name: string | null; registeredAt: Date | null }>
  >`
    SELECT prototype."id", prototype."branch_name" AS "branchName",
      prototype."name", prototype."registered_at" AS "registeredAt"
    FROM "prototypes" prototype
    JOIN "repositories" repository ON repository."id" = prototype."repository_id"
    JOIN "builds" build ON build."prototype_id" = prototype."id"
    WHERE build."id" = ${buildId}::uuid
      AND build."state" = 'successful'
      AND build."github_workflow_run_id" IS NOT NULL
      AND repository."removed_at" IS NULL
      AND prototype."branch_deleted_at" IS NULL
      AND NOT prototype."replica"
      AND prototype."branch_name" NOT IN (repository."default_branch", 'replica/install-workflow')
    FOR SHARE OF repository
    FOR UPDATE OF prototype
  `
  return rows[0] ?? null
}
