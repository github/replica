import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockSelectedAuthenticationProvider(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  key: string,
) {
  const rows = await database.$queryRaw<
    Array<{ enabled: boolean; selectedRevisionId: string | null }>
  >`
    SELECT "enabled", "selected_revision_id" AS "selectedRevisionId"
    FROM "authentication_providers"
    WHERE "key" = ${key}
    FOR SHARE
  `
  return rows[0] ?? null
}
