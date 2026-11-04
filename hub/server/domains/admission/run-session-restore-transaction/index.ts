import { Prisma } from "../../../generated/prisma/client.ts"

import { findRestorableHubSession } from "../../../repositories/hub-sessions/find-restorable-hub-session/index.ts"
import { lockRestorableHubSession } from "../../../repositories/hub-sessions/lock-restorable-hub-session/index.ts"
import { lockActiveMembershipAssignment } from "../../../repositories/membership-assignments/lock-active-membership-assignment/index.ts"
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
        getRevocation: () => getSessionRevocationState(transaction),
        lockActiveAssignment: (membershipId) =>
          lockActiveMembershipAssignment(transaction, membershipId),
        lockMembership: (membershipId) => lockMembershipById(transaction, membershipId),
        lockSession: (digest) => lockRestorableHubSession(transaction, digest),
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
}
