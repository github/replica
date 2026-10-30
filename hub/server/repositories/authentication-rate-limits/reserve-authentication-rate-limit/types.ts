import type { Prisma } from "../../../generated/prisma/client.ts"

export interface ReserveAuthenticationRateLimitInput {
  id: string
  keyDigest: string
  limit: number
  scope: "github_callback" | "github_start"
  windowSeconds: number
}

export interface AuthenticationRateLimitDatabase {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}
