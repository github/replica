import type { Prisma } from "../../../generated/prisma/client.ts"

export type FindExternalIdentityDatabase = Pick<Prisma.TransactionClient, "externalIdentity">

export interface ExternalIdentityTuple {
  provider: string
  issuer: string
  subject: string
}
