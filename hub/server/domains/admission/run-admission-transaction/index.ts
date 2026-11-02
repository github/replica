import { Prisma } from "../../../generated/prisma/client.ts"

import { lockSelectedAuthenticationProvider } from "../../../repositories/authentication-providers/lock-selected-authentication-provider/index.ts"
import { lockConsumedAuthorizationAttempt } from "../../../repositories/authorization-attempts/lock-consumed-authorization-attempt/index.ts"
import { lockExternalIdentity } from "../../../repositories/external-identities/lock-external-identity/index.ts"
import { createHubSession } from "../../../repositories/hub-sessions/create-hub-session/index.ts"
import { createOrRestoreBootstrapAssignment } from "../../../repositories/membership-assignments/create-or-restore-bootstrap-assignment/index.ts"
import { lockActiveMembershipAssignment } from "../../../repositories/membership-assignments/lock-active-membership-assignment/index.ts"
import { createOrRestoreMembership } from "../../../repositories/memberships/create-or-restore-membership/index.ts"
import { lockMembership } from "../../../repositories/memberships/lock-membership/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { lockUser } from "../../../repositories/users/lock-user/index.ts"
import { classifyPrismaTransactionError } from "../../../utils/classify-prisma-transaction-error/index.ts"
import { AdmissionTransactionConflictError } from "../errors.ts"
import type { AdmissionDatabaseClient, AdmissionRepositories } from "./types.ts"
import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"

export function runAdmissionTransaction<Result>(
  database: AdmissionDatabaseClient,
  operation: (repositories: AdmissionRepositories) => Promise<Result>,
  writeSuccessAudit: (
    transaction: Prisma.TransactionClient,
    event: CreateSecurityAuditEvent,
  ) => Promise<unknown> = createSecurityAudit,
): Promise<Result> {
  return database
    .$transaction(
      (transaction) =>
        operation({
          createBootstrapAssignment: (input) =>
            createOrRestoreBootstrapAssignment(transaction, input),
          createHubSession: (input) => createHubSession(transaction, input),
          createOrRestoreMembership: (input) => createOrRestoreMembership(transaction, input),
          createSecurityAudit: (input) => writeSuccessAudit(transaction, input),
          lockActiveAssignment: (membershipId) =>
            lockActiveMembershipAssignment(transaction, membershipId),
          lockAttempt: (id) => lockConsumedAuthorizationAttempt(transaction, id),
          lockExternalIdentity: (id) => lockExternalIdentity(transaction, id),
          lockMembership: (userId) => lockMembership(transaction, userId),
          lockProvider: (key) => lockSelectedAuthenticationProvider(transaction, key),
          lockRevocation: () => lockSessionRevocationState(transaction),
          lockUser: (id) => lockUser(transaction, id),
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error: unknown) => {
      if (classifyPrismaTransactionError(error) === "retryable") {
        throw new AdmissionTransactionConflictError({ cause: error })
      }
      throw error
    })
}
