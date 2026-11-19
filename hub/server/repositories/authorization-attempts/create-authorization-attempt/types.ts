import type { Prisma } from "../../../generated/prisma/client.ts"
import type { AuthorizationAttemptPurpose } from "../../../generated/prisma/enums.ts"

export type CreateAuthorizationAttemptDatabase = Pick<Prisma.TransactionClient, "$queryRaw">

export interface CreateAuthorizationAttemptInput {
  bootstrapSecretDigest: string | null
  browserBindingDigest: string
  codeVerifierCiphertext: string
  id: string
  lifetimeSeconds: number
  nonceCiphertext: string
  purpose: AuthorizationAttemptPurpose
  providerRevisionId: string
  sensitiveAuthorizationId?: string
  sessionRevocationRevision: number
  stateDigest: string
}
