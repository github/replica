import type { Prisma } from "../../../generated/prisma/client.ts"
import { z } from "zod"

const providerKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/)

export async function lockAuthenticationProviderSelection(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  providerKey: string,
): Promise<void> {
  const key = providerKeySchema.parse(providerKey)
  await database.$queryRaw`
    SELECT "id"
    FROM "authentication_providers"
    WHERE "key" = ${key}
    FOR SHARE
  `
}
