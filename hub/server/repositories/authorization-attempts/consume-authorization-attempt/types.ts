import type { Prisma } from "../../../generated/prisma/client.ts"

export interface ConsumeAuthorizationAttemptDatabase {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

export interface ConsumeAuthorizationAttemptInput {
  browserBindingDigest: string
  stateDigest: string
}
