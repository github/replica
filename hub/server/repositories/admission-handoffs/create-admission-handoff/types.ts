import type { Prisma } from "../../../generated/prisma/client.ts"

export type CreateAdmissionHandoffDatabase = Pick<Prisma.TransactionClient, "admissionHandoff">

export interface CreateAdmissionHandoffInput {
  browserBindingDigest: string
  displayAttributes: {
    avatarUrl: string | null
    email: string | null
    login: string
    name: string | null
  }
  expiresAt: Date
  externalIdentityId: string
  id: string
  providerRevisionId: string
  revocationGeneration: bigint
  tokenDigest: string
}
