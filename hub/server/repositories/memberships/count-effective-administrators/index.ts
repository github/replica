import type { Prisma } from "../../../generated/prisma/client.ts"
import { createEffectiveAdministratorFilter } from "../../../utils/create-effective-administrator-filter/index.ts"

export async function countEffectiveAdministrators(
  database: Pick<Prisma.TransactionClient, "membership">,
) {
  return database.membership.count({ where: createEffectiveAdministratorFilter() })
}
