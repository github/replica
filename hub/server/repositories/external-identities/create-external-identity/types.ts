import type { Prisma } from "../../../generated/prisma/client.ts"

export type CreateExternalIdentityDatabase = Pick<Prisma.TransactionClient, "externalIdentity">

export interface CreateExternalIdentityInput {
  id: string
  userId: string
  provider: string
  issuer: string
  subject: string
}
