import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockAuthenticationProviderForSessionRestore(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  key: string,
) {
  const rows = await database.$queryRaw<Array<{ enabled: boolean; id: string }>>`
    SELECT "enabled", "id"
    FROM "authentication_providers"
    WHERE "key" = ${key}
    FOR SHARE
  `
  return rows[0] ?? null
}
