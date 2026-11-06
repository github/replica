import { Prisma } from "../../../generated/prisma/client.ts"
import { createExternalIdentity } from "../../../repositories/external-identities/create-external-identity/index.ts"
import { findExternalIdentity } from "../../../repositories/external-identities/find-external-identity/index.ts"
import { lockSelectedAuthenticationProvider } from "../../../repositories/authentication-providers/lock-selected-authentication-provider/index.ts"
import { lockConsumedAuthorizationAttempt } from "../../../repositories/authorization-attempts/lock-consumed-authorization-attempt/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { createUser } from "../../../repositories/users/create-user/index.ts"
import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { IdentityTransactionConflictError } from "../errors.ts"
import type {
  FindExternalIdentityForTransaction,
  IdentityCreationRepositories,
  IdentityDatabaseClient,
} from "./types.ts"

export function runIdentityCreationTransaction<Result>(
  database: IdentityDatabaseClient,
  operation: (repositories: IdentityCreationRepositories) => Promise<Result>,
  findIdentity: FindExternalIdentityForTransaction = findExternalIdentity,
): Promise<Result> {
  return database
    .$transaction(
      (transaction) =>
        operation({
          createExternalIdentity: (input) => createExternalIdentity(transaction, input),
          createSecurityAudit: (input) => createSecurityAudit(transaction, input),
          createUser: (input) => createUser(transaction, input),
          findExternalIdentity: (tuple) => findIdentity(transaction, tuple),
          lockAttempt: (id) => lockConsumedAuthorizationAttempt(transaction, id),
          lockProvider: (key) => lockSelectedAuthenticationProvider(transaction, key),
          lockRevocation: () => lockSessionRevocationState(transaction),
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error: unknown) => {
      if (classifyPrismaTransactionError(error) === "retryable") {
        throw new IdentityTransactionConflictError({ cause: error })
      }
      throw error
    })
}
