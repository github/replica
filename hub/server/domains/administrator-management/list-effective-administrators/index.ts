import type { Prisma } from "../../../generated/prisma/client.ts"

import { listEffectiveAdministrators as listEffectiveAdministratorsRepository } from "../../../repositories/memberships/list-effective-administrators/index.ts"

export function listEffectiveAdministrators(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input?: {
    before?: { createdAt: Date; membershipId: string }
    limit?: number
  },
) {
  return listEffectiveAdministratorsRepository(database, input)
}
