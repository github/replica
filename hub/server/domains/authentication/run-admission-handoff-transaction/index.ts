import { Prisma } from "../../../generated/prisma/client.ts"
import { consumeAdmissionHandoff } from "../../../repositories/admission-handoffs/consume-admission-handoff/index.ts"
import { createAdmissionHandoff } from "../../../repositories/admission-handoffs/create-admission-handoff/index.ts"
import { findAdmissionHandoff } from "../../../repositories/admission-handoffs/find-admission-handoff/index.ts"
import { findAuthenticationProvider } from "../../../repositories/authentication-providers/find-authentication-provider/index.ts"
import { lockAuthenticationProviderSelection } from "../../../repositories/authentication-providers/lock-authentication-provider-selection/index.ts"
import { getAuthenticationRevocationGeneration } from "../../../repositories/authentication-revocation-generations/get-authentication-revocation-generation/index.ts"
import { lockAuthenticationRevocationGeneration } from "../../../repositories/authentication-revocation-generations/lock-authentication-revocation-generation/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { IdentityTransactionConflictError } from "../../identity/errors.ts"
import type {
  AdmissionHandoffDatabase,
  AdmissionHandoffRepositories,
  AdmissionHandoffTransactionFunctions,
} from "./types.ts"

export function runAdmissionHandoffTransaction<Result>(
  database: AdmissionHandoffDatabase,
  operation: (repositories: AdmissionHandoffRepositories) => Promise<Result>,
  functions: AdmissionHandoffTransactionFunctions = {
    lockProvider: lockAuthenticationProviderSelection,
    lockRevocation: lockAuthenticationRevocationGeneration,
  },
): Promise<Result> {
  return database
    .$transaction(
      (transaction) =>
        operation({
          consumeAdmissionHandoff: (input) => consumeAdmissionHandoff(transaction, input),
          createAdmissionHandoff: (input) => createAdmissionHandoff(transaction, input),
          createSecurityAudit: (input) => createSecurityAudit(transaction, input),
          findAdmissionHandoff: (tokenDigest) => findAdmissionHandoff(transaction, tokenDigest),
          findAuthenticationProvider: (key) => findAuthenticationProvider(transaction, key),
          getAuthenticationRevocationGeneration: () =>
            getAuthenticationRevocationGeneration(transaction),
          lockAuthenticationProviderSelection: (key) => functions.lockProvider(transaction, key),
          lockAuthenticationRevocationGeneration: () => functions.lockRevocation(transaction),
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error: unknown) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      ) {
        throw new IdentityTransactionConflictError({ cause: error })
      }
      throw error
    })
}
