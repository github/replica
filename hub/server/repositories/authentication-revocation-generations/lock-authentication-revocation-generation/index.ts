import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockAuthenticationRevocationGeneration(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
): Promise<void> {
  await database.$queryRaw`
    SELECT "id"
    FROM "authentication_revocation_generations"
    WHERE "key" = 'global'
    FOR SHARE
  `
}
