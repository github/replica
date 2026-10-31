import type { Prisma } from "../../../generated/prisma/client.ts"

export type CreateAdmissionHandoffDatabase = Pick<Prisma.TransactionClient, "$queryRaw">

export interface CreateAdmissionHandoffInput {
  browserBindingDigest: string
  displayAttributes: {
    avatarUrl: string | null
    email: string | null
    login: string
    name: string | null
  }
  externalIdentityId: string
  id: string
  lifetimeSeconds: number
  providerRevisionId: string
  revocationGeneration: bigint
  tokenDigest: string
}
