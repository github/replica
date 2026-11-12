import { Prisma } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
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
      (transaction) => operation(createAdministratorManagementRepositories(transaction)),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error: unknown) => {
      if (classifyPrismaTransactionError(error) === "retryable") {
        throw new AdministratorManagementTransactionConflictError({ cause: error })
      }
      throw error
    })
}
