import { Prisma } from "../../../generated/prisma/client.ts"

import { findRestorableHubSession } from "../../../repositories/hub-sessions/find-restorable-hub-session/index.ts"
import { lockRestorableHubSession } from "../../../repositories/hub-sessions/lock-restorable-hub-session/index.ts"
import { lockAuthenticationProviderForSessionRestore } from "../../../repositories/authentication-providers/lock-authentication-provider-for-session-restore/index.ts"
import { getActiveProviderKeys } from "../../../repositories/membership-assignments/get-active-provider-keys/index.ts"
import { lockActiveMembershipAssignments } from "../../../repositories/membership-assignments/lock-active-membership-assignments/index.ts"
import { lockMembershipById } from "../../../repositories/memberships/lock-membership-by-id/index.ts"
import { getSessionRevocationState } from "../../../repositories/session-revocation-states/get-session-revocation-state/index.ts"
import type { SessionRestoreDatabaseClient, SessionRestoreRepositories } from "./types.ts"

export function runSessionRestoreTransaction<Result>(
  database: SessionRestoreDatabaseClient,
  operation: (repositories: SessionRestoreRepositories) => Promise<Result>,
): Promise<Result> {
  return database.$transaction(
    (transaction) =>
      operation({
        findSession: (digest) => findRestorableHubSession(transaction, digest),
        getActiveProviderKeys: (membershipId) => getActiveProviderKeys(transaction, membershipId),
        getRevocation: () => getSessionRevocationState(transaction),
        lockActiveAssignments: (membershipId) =>
          lockActiveMembershipAssignments(transaction, membershipId),
        lockMembership: (membershipId) => lockMembershipById(transaction, membershipId),
        lockProvider: (key) => lockAuthenticationProviderForSessionRestore(transaction, key),
        lockSession: (digest) => lockRestorableHubSession(transaction, digest),
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
}
