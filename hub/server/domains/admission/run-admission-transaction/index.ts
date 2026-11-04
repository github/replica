import { Prisma } from "../../../generated/prisma/client.ts"

import { lockSelectedAuthenticationProvider } from "../../../repositories/authentication-providers/lock-selected-authentication-provider/index.ts"
import { lockConsumedAuthorizationAttempt } from "../../../repositories/authorization-attempts/lock-consumed-authorization-attempt/index.ts"
import { getExternalIdentity } from "../../../repositories/external-identities/get-external-identity/index.ts"
import { createHubSession } from "../../../repositories/hub-sessions/create-hub-session/index.ts"
import { endOpenHubSessionsForMembership } from "../../../repositories/hub-sessions/end-open-hub-sessions-for-membership/index.ts"
import { createOrRestoreBootstrapAssignment } from "../../../repositories/membership-assignments/create-or-restore-bootstrap-assignment/index.ts"
import { lockActiveMembershipAssignment } from "../../../repositories/membership-assignments/lock-active-membership-assignment/index.ts"
import { createOrRestoreMembership } from "../../../repositories/memberships/create-or-restore-membership/index.ts"
import { lockMembership } from "../../../repositories/memberships/lock-membership/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { classifyPrismaTransactionError } from "../../../utils/classify-prisma-transaction-error/index.ts"
import { AdmissionTransactionConflictError } from "../errors.ts"
import type { AdmissionDatabaseClient, AdmissionRepositories } from "./types.ts"

export function runAdmissionTransaction<Result>(
  database: AdmissionDatabaseClient,
  operation: (repositories: AdmissionRepositories) => Promise<Result>,
): Promise<Result> {
  return database
    .$transaction(
      (transaction) =>
        operation({
          createBootstrapAssignment: (input) =>
            createOrRestoreBootstrapAssignment(transaction, input),
          createHubSession: (input) => createHubSession(transaction, input),
          createOrRestoreMembership: (input) => createOrRestoreMembership(transaction, input),
          createSecurityAudit: (input) => createSecurityAudit(transaction, input),
          endOpenHubSessionsForMembership: (membershipId) =>
            endOpenHubSessionsForMembership(transaction, membershipId),
          lockActiveAssignment: (membershipId) =>
            lockActiveMembershipAssignment(transaction, membershipId),
          lockAttempt: (id) => lockConsumedAuthorizationAttempt(transaction, id),
          getExternalIdentity: (id) => getExternalIdentity(transaction, id),
          lockMembership: (userId) => lockMembership(transaction, userId),
          lockProvider: (key) => lockSelectedAuthenticationProvider(transaction, key),
          lockRevocation: () => lockSessionRevocationState(transaction),
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
