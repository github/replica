import type { Prisma } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { lockRepositoryAdministratorAuthority } from "../../../repositories/repository-access/lock-repository-administrator-authority/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"

export function authorizeRepositoryAdministration(
  database: {
    $transaction<Result>(
      operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    ): Promise<Result>
  },
  input: { membershipId: string; repositoryId: string },
): Promise<boolean> {
  return runWithBoundedRetries(
    () =>
      database.$transaction((transaction) =>
        lockRepositoryAdministratorAuthority(transaction, input),
      ),
    (error) => classifyPrismaTransactionError(error) === "retryable",
  )
}
