import { Prisma } from "../../../generated/prisma/client.ts"

import { lockSelectedAuthenticationProvider } from "../../../repositories/authentication-providers/lock-selected-authentication-provider/index.ts"
import { lockConsumedAuthorizationAttempt } from "../../../repositories/authorization-attempts/lock-consumed-authorization-attempt/index.ts"
import { getExternalIdentity } from "../../../repositories/external-identities/get-external-identity/index.ts"
import { createHubSession } from "../../../repositories/hub-sessions/create-hub-session/index.ts"
import { endOpenHubSessionsForMembership } from "../../../repositories/hub-sessions/end-open-hub-sessions-for-membership/index.ts"
import { createProviderAssignment } from "../../../repositories/membership-assignments/create-provider-assignment/index.ts"
import { createOrRestoreBootstrapAssignment } from "../../../repositories/membership-assignments/create-or-restore-bootstrap-assignment/index.ts"
import { endProviderAssignment } from "../../../repositories/membership-assignments/end-provider-assignment/index.ts"
import { lockActiveMembershipAssignments } from "../../../repositories/membership-assignments/lock-active-membership-assignments/index.ts"
import { lockActiveProviderAssignment } from "../../../repositories/membership-assignments/lock-active-provider-assignment/index.ts"
import { createMembership } from "../../../repositories/memberships/create-membership/index.ts"
import { createOrRestoreMembership } from "../../../repositories/memberships/create-or-restore-membership/index.ts"
import { lockMembership } from "../../../repositories/memberships/lock-membership/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { claimProviderEvidence } from "../../../repositories/provider-evidence-states/claim-provider-evidence/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
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
          claimProviderEvidence: (input) => claimProviderEvidence(transaction, input),
          createMembership: (input) => createMembership(transaction, input),
          createProviderAssignment: (input) => createProviderAssignment(transaction, input),
          createBootstrapAssignment: (input) =>
            createOrRestoreBootstrapAssignment(transaction, input),
          createHubSession: (input) => createHubSession(transaction, input),
          createOrRestoreMembership: (input) => createOrRestoreMembership(transaction, input),
          createSecurityAudit: (input) => createSecurityAudit(transaction, input),
          endProviderAssignment: (input) => endProviderAssignment(transaction, input),
          endOpenHubSessionsForMembership: (membershipId) =>
            endOpenHubSessionsForMembership(transaction, membershipId),
          lockActiveAssignments: (membershipId) =>
            lockActiveMembershipAssignments(transaction, membershipId),
          lockActiveProviderAssignment: (externalIdentityId) =>
            lockActiveProviderAssignment(transaction, externalIdentityId),
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
