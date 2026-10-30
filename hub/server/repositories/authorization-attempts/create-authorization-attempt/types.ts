import type { Prisma } from "../../../generated/prisma/client.ts"

export type CreateAuthorizationAttemptDatabase = Pick<
  Prisma.TransactionClient,
  "authorizationAttempt"
>

export interface CreateAuthorizationAttemptInput {
  browserBindingDigest: string
  codeChallenge: string
  codeVerifierCiphertext: string
  expiresAt: Date
  id: string
  providerRevisionId: string
  requestIpDigest: string
  stateDigest: string
}
