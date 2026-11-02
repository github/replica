import type { Prisma } from "../../../generated/prisma/client.ts"

export interface SessionRestoreRepositories {
  getRevocation(): Promise<{ revision: number } | null>
  lockActiveAssignment(membershipId: string): Promise<{ role: "ADMINISTRATOR" } | null>
  lockMembership(
    userId: string,
  ): Promise<{ id: string; lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED" } | null>
  lockSession(digest: string): Promise<{
    id: string
    membershipId: string
    revocationRevision: number
    userId: string
  } | null>
}

export type SessionRestoreTransaction = <Result>(
  operation: (repositories: SessionRestoreRepositories) => Promise<Result>,
) => Promise<Result>

export interface SessionRestoreDatabaseClient {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}
