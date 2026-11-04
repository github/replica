import type { Prisma } from "../../../generated/prisma/client.ts"

export type CreateAuthorizationAttemptDatabase = Pick<Prisma.TransactionClient, "$queryRaw">

export interface CreateAuthorizationAttemptInput {
  bootstrapSecretDigest: string | null
  browserBindingDigest: string
  codeVerifierCiphertext: string
  id: string
  lifetimeSeconds: number
  purpose: "SIGN_IN" | "ADMIN_ENROLLMENT"
  providerRevisionId: string
  stateDigest: string
}
