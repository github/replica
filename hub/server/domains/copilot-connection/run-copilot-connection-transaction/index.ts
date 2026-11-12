import { Prisma } from "../../../generated/prisma/client.ts"
import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
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
    .$transaction((transaction) => operation(createRepositories(transaction)), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
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
