import type { UserInput } from "#server/repositories/users/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function createUser(database: Prisma.TransactionClient, input: UserInput) {
  return database.user.create({ data: input })
}
