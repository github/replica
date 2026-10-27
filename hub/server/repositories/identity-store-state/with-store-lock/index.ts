import { staticIdentityStoreRecordId } from "#server/repositories/identity-store-state/constants"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export function withIdentityStoreLock<T>(
  client: PrismaClient,
  operation: (database: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.identityStoreState.upsert({
      where: { id: staticIdentityStoreRecordId },
      create: { id: staticIdentityStoreRecordId },
      update: {},
    })
    await transaction.$queryRaw`SELECT id FROM identity_store_states WHERE id = ${staticIdentityStoreRecordId}::uuid FOR UPDATE`
    return operation(transaction)
  })
}
