import { Prisma } from "../../../generated/prisma/client.ts"
import { createAuthenticationProviderRevision } from "../../../repositories/authentication-providers/create-authentication-provider-revision/index.ts"
import { createAuthenticationProvider } from "../../../repositories/authentication-providers/create-authentication-provider/index.ts"
import { findAuthenticationProvider } from "../../../repositories/authentication-providers/find-authentication-provider/index.ts"
import { selectAuthenticationProviderRevision } from "../../../repositories/authentication-providers/select-authentication-provider-revision/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { IdentityTransactionConflictError } from "../errors.ts"
import type { ProviderRevisionDatabaseClient, ProviderRevisionRepositories } from "./types.ts"

export function runProviderRevisionTransaction<Result>(
  database: ProviderRevisionDatabaseClient,
  operation: (repositories: ProviderRevisionRepositories) => Promise<Result>,
): Promise<Result> {
  return database
    .$transaction(
      (transaction) =>
        operation({
          createAuthenticationProvider: (input) => createAuthenticationProvider(transaction, input),
          createAuthenticationProviderRevision: (input) =>
            createAuthenticationProviderRevision(transaction, input),
          createSecurityAudit: (input) => createSecurityAudit(transaction, input),
          findAuthenticationProvider: (key) => findAuthenticationProvider(transaction, key),
          selectAuthenticationProviderRevision: (input) =>
            selectAuthenticationProviderRevision(transaction, input),
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error: unknown) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2003", "P2034"].includes(error.code)
      ) {
        throw new IdentityTransactionConflictError({ cause: error })
      }
      throw error
    })
}
