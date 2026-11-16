import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockAuthenticationProvidersForPrototypeEdit(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  await database.$queryRaw`
    SELECT "id"
    FROM "authentication_providers"
    ORDER BY "key"
    FOR SHARE
  `
}
