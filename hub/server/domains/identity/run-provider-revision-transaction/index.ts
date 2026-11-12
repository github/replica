import { Prisma } from "../../../generated/prisma/client.ts"
import { createAuthenticationProviderRevision } from "../../../repositories/authentication-providers/create-authentication-provider-revision/index.ts"
import { createAuthenticationProvider } from "../../../repositories/authentication-providers/create-authentication-provider/index.ts"
import { disableAuthenticationProvider } from "../../../repositories/authentication-providers/disable-authentication-provider/index.ts"
import { enableAuthenticationProvider } from "../../../repositories/authentication-providers/enable-authentication-provider/index.ts"
import { findAuthenticationProvider } from "../../../repositories/authentication-providers/find-authentication-provider/index.ts"
import { lockAuthenticationProvidersForReconciliation } from "../../../repositories/authentication-providers/lock-authentication-providers-for-reconciliation/index.ts"
import { selectAuthenticationProviderRevision } from "../../../repositories/authentication-providers/select-authentication-provider-revision/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { disconnectCopilotConnectionWithoutEffectiveAdministrator } from "../../../repositories/copilot-connection-state/disconnect-copilot-connection-without-effective-administrator/index.ts"
import { incrementSessionRevocationState } from "../../../repositories/session-revocation-states/increment-session-revocation-state/index.ts"
import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { IdentityTransactionConflictError } from "../errors.ts"
import type {
  AuthenticationProviderReconciliationRepositories,
  FindAuthenticationProviderForTransaction,
  ProviderRevisionDatabaseClient,
} from "./types.ts"

export function runProviderRevisionTransaction<Result>(
  database: ProviderRevisionDatabaseClient,
  operation: (repositories: AuthenticationProviderReconciliationRepositories) => Promise<Result>,
  findProvider: FindAuthenticationProviderForTransaction = findAuthenticationProvider,
): Promise<Result> {
  return database
    .$transaction(
      (transaction) =>
        operation({
          createAuthenticationProvider: (input) => createAuthenticationProvider(transaction, input),
          createAuthenticationProviderRevision: (input) =>
            createAuthenticationProviderRevision(transaction, input),
          createSecurityAudit: (input) => createSecurityAudit(transaction, input),
          disconnectCopilotConnectionWithoutEffectiveAdministrator: () =>
            disconnectCopilotConnectionWithoutEffectiveAdministrator(transaction),
          disableAuthenticationProvider: (providerId) =>
            disableAuthenticationProvider(transaction, providerId),
          enableAuthenticationProvider: (input) => enableAuthenticationProvider(transaction, input),
          findAuthenticationProvider: (key) => findProvider(transaction, key),
          incrementSessionRevocation: () => incrementSessionRevocationState(transaction),
          lockAuthenticationProviders: () =>
            lockAuthenticationProvidersForReconciliation(transaction),
          selectAuthenticationProviderRevision: (input) =>
            selectAuthenticationProviderRevision(transaction, input),
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
