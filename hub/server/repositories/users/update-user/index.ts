import type { UserInput } from "#server/repositories/users/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function updateUser(database: Prisma.TransactionClient, id: string, input: UserInput) {
  return database.user.update({ where: { id }, data: input })
}
