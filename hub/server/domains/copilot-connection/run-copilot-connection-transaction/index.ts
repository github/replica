import { Prisma } from "../../../generated/prisma/client.ts"
import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { lockAuthenticationProvidersForSessionAuthority } from "../../../repositories/authentication-providers/lock-authentication-providers-for-session-authority/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { CopilotConnectionError } from "../errors.ts"
import type { CopilotConnectionTransactionRepositories } from "../types.ts"

export interface CopilotConnectionDatabaseClient {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

export function runCopilotConnectionTransaction<Result>(
  database: CopilotConnectionDatabaseClient,
  createRepositories: (
    transaction: Prisma.TransactionClient,
  ) => CopilotConnectionTransactionRepositories,
  operation: (repositories: CopilotConnectionTransactionRepositories) => Promise<Result>,
) {
  return database
    .$transaction(
      async (transaction) => {
        // Reconciliation locks providers first, so keep that order to avoid deadlocks.
        await lockAuthenticationProvidersForSessionAuthority(transaction)
        await lockSessionRevocationState(transaction)
        return operation(createRepositories(transaction))
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error: unknown) => {
      if (classifyPrismaTransactionError(error) === "retryable") {
        throw new CopilotConnectionError(
          "connection_changed",
          "The Copilot connection changed during this request.",
          { cause: error },
        )
      }
      throw error
    })
}
