import { stateId } from "#server/utils/identity-contracts/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function advanceIdentityGeneration(database: Prisma.TransactionClient) {
  await database.identityState.update({
    where: { id: stateId },
    data: { generation: { increment: 1 } },
  })
  await database.oAuthAttempt.deleteMany()
}
