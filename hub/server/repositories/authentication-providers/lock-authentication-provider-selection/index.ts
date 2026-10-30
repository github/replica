import type { Prisma } from "../../../generated/prisma/client.ts"
import { parseProviderKey } from "../../../utils/parse-provider-key/index.ts"

export async function lockAuthenticationProviderSelection(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  providerKey: string,
): Promise<void> {
  const key = parseProviderKey(providerKey)
  await database.$queryRaw`
    SELECT "id"
    FROM "authentication_providers"
    WHERE "key" = ${key}
    FOR SHARE
  `
}
