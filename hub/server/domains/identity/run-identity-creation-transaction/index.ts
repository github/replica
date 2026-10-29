import { Prisma } from "../../../generated/prisma/client.ts"
import { createExternalIdentity } from "../../../repositories/external-identities/create-external-identity/index.ts"
import { findExternalIdentity } from "../../../repositories/external-identities/find-external-identity/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { createUser } from "../../../repositories/users/create-user/index.ts"
import { IdentityTransactionConflictError } from "../errors.ts"
import type { IdentityCreationRepositories, IdentityDatabaseClient } from "./types.ts"

export function runIdentityCreationTransaction<Result>(
  database: IdentityDatabaseClient,
  operation: (repositories: IdentityCreationRepositories) => Promise<Result>,
): Promise<Result> {
  return database
    .$transaction(
      (transaction) =>
        operation({
          createExternalIdentity: (input) => createExternalIdentity(transaction, input),
          createSecurityAudit: (input) => createSecurityAudit(transaction, input),
          createUser: (input) => createUser(transaction, input),
          findExternalIdentity: (tuple) => findExternalIdentity(transaction, tuple),
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
