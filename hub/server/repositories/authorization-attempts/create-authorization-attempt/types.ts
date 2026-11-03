import type { Prisma } from "../../../generated/prisma/client.ts"

export type CreateAuthorizationAttemptDatabase = Pick<Prisma.TransactionClient, "$queryRaw">

export interface CreateAuthorizationAttemptInput {
  browserBindingDigest: string
  codeVerifierCiphertext: string
  id: string
  lifetimeSeconds: number
  providerRevisionId: string
  stateDigest: string
}
