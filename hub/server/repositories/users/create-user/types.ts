import type { Prisma } from "../../../generated/prisma/client.ts"

export type CreateUserDatabase = Pick<Prisma.TransactionClient, "user">

export interface CreateUserInput {
  id: string
}
