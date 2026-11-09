import type { Prisma } from "../../../generated/prisma/client.ts"

import { countEffectiveAdministrators as countEffectiveAdministratorsRepository } from "../../../repositories/memberships/count-effective-administrators/index.ts"

export function countEffectiveAdministrators(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  return countEffectiveAdministratorsRepository(database)
}
