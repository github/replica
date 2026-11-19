import { Prisma } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { lockSessionAuthorityChanges } from "../../../repositories/hub-sessions/lock-session-authority-changes/index.ts"
import { AdministratorManagementTransactionConflictError } from "../errors.ts"
import { createAdministratorManagementRepositories } from "../create-administrator-management-repositories/index.ts"
import type {
  AdministratorManagementDatabaseClient,
  AdministratorManagementRepositories,
} from "./types.ts"

export function runAdministratorManagementTransaction<Result>(
  database: AdministratorManagementDatabaseClient,
  operation: (repositories: AdministratorManagementRepositories) => Promise<Result>,
): Promise<Result> {
  return database
    .$transaction(
      async (transaction) => {
        await lockSessionAuthorityChanges(transaction, { timeoutMs: 500 })
        return operation(createAdministratorManagementRepositories(transaction))
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error: unknown) => {
      if (classifyPrismaTransactionError(error) === "retryable") {
        throw new AdministratorManagementTransactionConflictError({ cause: error })
      }
      throw error
    })
}
