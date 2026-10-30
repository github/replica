import type { Prisma } from "../../../generated/prisma/client.ts"

export type ConsumeAuthorizationAttemptDatabase = Pick<
  Prisma.TransactionClient,
  "authorizationAttempt"
>

export interface ConsumeAuthorizationAttemptInput {
  browserBindingDigest: string
  consumedAt: Date
  stateDigest: string
}
