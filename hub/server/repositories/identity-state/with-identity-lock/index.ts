import { identityStateId } from "#server/repositories/identity-state/constants"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export function withIdentityLock<T>(
  client: PrismaClient,
  operation: (database: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.identityState.upsert({
      where: { id: identityStateId },
      create: { id: identityStateId },
      update: {},
    })
    await transaction.$queryRaw`SELECT id FROM identity_states WHERE id = ${identityStateId}::uuid FOR UPDATE`
    return operation(transaction)
  })
}
