import { stateId } from "#server/utils/identity-contracts/constants"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export function withIdentityLock<T>(
  client: PrismaClient,
  operation: (database: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.identityState.upsert({
      where: { id: stateId },
      create: { id: stateId },
      update: {},
    })
    await transaction.$queryRaw`SELECT id FROM identity_states WHERE id = ${stateId}::uuid FOR UPDATE`
    return operation(transaction)
  })
}
