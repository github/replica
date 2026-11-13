import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockGitHubRepositoryAccessState(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  mode: "read" | "write" = "read",
) {
  const rows =
    mode === "write"
      ? await database.$queryRaw<Array<{ revision: number; changedAt: Date | null }>>`
          SELECT "revision", "changed_at" AS "changedAt"
          FROM "github_repository_access_states"
          WHERE "key" = 'global'
          FOR UPDATE
        `
      : await database.$queryRaw<Array<{ revision: number; changedAt: Date | null }>>`
          SELECT "revision", "changed_at" AS "changedAt"
          FROM "github_repository_access_states"
          WHERE "key" = 'global'
          FOR SHARE
        `
  if (!rows[0]) throw new Error("GitHub repository access authority is missing.")
  return rows[0]
}
