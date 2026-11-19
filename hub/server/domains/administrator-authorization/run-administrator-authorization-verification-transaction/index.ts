import { Prisma } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { getSensitiveAuthorizationAuditData } from "../../../repositories/sensitive-authorizations/get-sensitive-authorization-audit-data/index.ts"
import { lockSessionAuthorityChanges } from "../../../repositories/hub-sessions/lock-session-authority-changes/index.ts"
import { lockSensitiveAuthorization } from "../../../repositories/sensitive-authorizations/lock-sensitive-authorization/index.ts"
import { verifySensitiveAuthorization } from "../../../repositories/sensitive-authorizations/verify-sensitive-authorization/index.ts"
import { createAdmissionRepositories } from "../../admission/create-admission-repositories/index.ts"
import { AdmissionTransactionConflictError } from "../../admission/errors.ts"
import type {
  AdministratorAuthorizationVerificationDatabase,
  AdministratorAuthorizationVerificationRepositories,
} from "./types.ts"

export function runAdministratorAuthorizationVerificationTransaction<Result>(
  database: AdministratorAuthorizationVerificationDatabase,
  operation: (repositories: AdministratorAuthorizationVerificationRepositories) => Promise<Result>,
): Promise<Result> {
  return database
    .$transaction(
      async (transaction) => {
        await lockSessionAuthorityChanges(transaction, { timeoutMs: 500 })
        return operation({
          ...createAdmissionRepositories(transaction),
          canVerifySensitiveAuthorization: async (input) =>
            Boolean(await verifySensitiveAuthorization(transaction, input, "check")),
          createHubSession: () => {
            throw new Error("Administrator authorization verification cannot create a session.")
          },
          recordRepositoryAccess: () => {
            throw new Error(
              "Administrator authorization verification cannot record repository access.",
            )
          },
          getSensitiveAuthorizationAuditData: (id) =>
            getSensitiveAuthorizationAuditData(transaction, id),
          verifySensitiveAuthorization: async (input) => {
            await lockSensitiveAuthorization(transaction, input.sensitiveAuthorizationId)
            return verifySensitiveAuthorization(transaction, input)
          },
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error: unknown) => {
      if (classifyPrismaTransactionError(error) === "retryable") {
        throw new AdmissionTransactionConflictError({ cause: error })
      }
      throw error
    })
}
