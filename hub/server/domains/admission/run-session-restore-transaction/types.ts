import type { Prisma } from "../../../generated/prisma/client.ts"

export interface SessionRestoreRepositories {
  findSession(digest: string): Promise<{
    id: string
    membershipId: string
    revocationRevision: number
  } | null>
  getRevocation(): Promise<{ revision: number } | null>
  lockActiveAssignments(membershipId: string): Promise<
    Array<{
      id: string
      role: "MEMBER" | "ADMINISTRATOR"
      source: "BOOTSTRAP" | "AUTHENTICATION_PROVIDER"
    }>
  >
  lockMembership(membershipId: string): Promise<{
    id: string
    lifecycle: "ACTIVE" | "SUSPENDED" | "REMOVED"
  } | null>
  lockSession(digest: string): Promise<{
    id: string
    membershipId: string
    revocationRevision: number
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
