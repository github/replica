import type { Prisma } from "../../../generated/prisma/client.ts"
import type { PublicIdentityAttributes } from "../../../domains/authentication/types.ts"

export type CreateAdmissionHandoffDatabase = Pick<Prisma.TransactionClient, "admissionHandoff">

export interface CreateAdmissionHandoffInput {
  browserBindingDigest: string
  displayAttributes: PublicIdentityAttributes
  expiresAt: Date
  externalIdentityId: string
  id: string
  providerRevisionId: string
  revocationGeneration: bigint
  tokenDigest: string
}
