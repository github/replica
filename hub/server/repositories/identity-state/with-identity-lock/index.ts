import { staticSettingsRecordId } from "#server/repositories/identity-state/constants"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export function withIdentityLock<T>(
  client: PrismaClient,
  operation: (database: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.identityState.upsert({
      where: { id: staticSettingsRecordId },
      create: { id: staticSettingsRecordId },
      update: {},
    })
    await transaction.$queryRaw`SELECT id FROM identity_states WHERE id = ${staticSettingsRecordId}::uuid FOR UPDATE`
    return operation(transaction)
  })
}
