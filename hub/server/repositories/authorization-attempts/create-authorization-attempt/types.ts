import type { Prisma } from "../../../generated/prisma/client.ts"

export type CreateAuthorizationAttemptDatabase = Pick<Prisma.TransactionClient, "$queryRaw">

export interface CreateAuthorizationAttemptInput {
  bootstrapSecretDigest: string | null
  browserBindingDigest: string
  codeVerifierCiphertext: string
  id: string
  lifetimeSeconds: number
  nonceCiphertext: string
  purpose: "SIGN_IN" | "ADMIN_ENROLLMENT" | "ADMINISTRATOR_MANAGEMENT"
  providerRevisionId: string
  sensitiveAuthorizationId?: string
  sessionRevocationRevision: number
  stateDigest: string
}
