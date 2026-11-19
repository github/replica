import { Prisma } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { lockSessionAuthorityChanges } from "../../../repositories/hub-sessions/lock-session-authority-changes/index.ts"
import { lockRepositoryAdministrationChanges } from "../../../repositories/repository-access/lock-repository-administration-changes/index.ts"
import { createAdmissionRepositories } from "../create-admission-repositories/index.ts"
import { AdmissionTransactionConflictError } from "../errors.ts"
import type { AdmissionDatabaseClient, AdmissionRepositories } from "./types.ts"

export function runAdmissionTransaction<Result>(
  database: AdmissionDatabaseClient,
  operation: (repositories: AdmissionRepositories) => Promise<Result>,
  options: { repositoryAuthorityChange?: boolean } = {},
): Promise<Result> {
  return database
    .$transaction(
      async (transaction) => {
        if (options.repositoryAuthorityChange) {
          await lockRepositoryAdministrationChanges(transaction, { timeoutMs: 500 })
          await lockSessionAuthorityChanges(transaction, { timeoutMs: 500 })
        }
        return operation(createAdmissionRepositories(transaction))
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    )
    .catch((error: unknown) => {
      if (classifyPrismaTransactionError(error) === "retryable") {
        throw new AdmissionTransactionConflictError({ cause: error })
      }
      throw error
    })
}
