import { Prisma } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { createAdmissionRepositories } from "../create-admission-repositories/index.ts"
import { AdmissionTransactionConflictError } from "../errors.ts"
import type { AdmissionDatabaseClient, AdmissionRepositories } from "./types.ts"

export function runAdmissionTransaction<Result>(
  database: AdmissionDatabaseClient,
  operation: (repositories: AdmissionRepositories) => Promise<Result>,
): Promise<Result> {
  return database
    .$transaction((transaction) => operation(createAdmissionRepositories(transaction)), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
    .catch((error: unknown) => {
      if (classifyPrismaTransactionError(error) === "retryable") {
        throw new AdmissionTransactionConflictError({ cause: error })
      }
      throw error
    })
}
