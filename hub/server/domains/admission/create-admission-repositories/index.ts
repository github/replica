import type { Prisma } from "../../../generated/prisma/client.ts"

import { lockSelectedAuthenticationProvider } from "../../../repositories/authentication-providers/lock-selected-authentication-provider/index.ts"
import { lockConsumedAuthorizationAttempt } from "../../../repositories/authorization-attempts/lock-consumed-authorization-attempt/index.ts"
import { getExternalIdentity } from "../../../repositories/external-identities/get-external-identity/index.ts"
import { lockGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/lock-github-repository-access-state/index.ts"
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
import { claimProviderEvidence } from "../../../repositories/provider-evidence-states/claim-provider-evidence/index.ts"
import { hasDisconnectedRepositories } from "../../../repositories/repository-access/has-disconnected-repositories/index.ts"
import { replaceRepositoryAccessGrants } from "../../../repositories/repository-access/replace-repository-access-grants/index.ts"
import { upsertConnectedRepositories } from "../../../repositories/repository-access/upsert-connected-repositories/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import type { AdmissionRepositories } from "../run-admission-transaction/types.ts"

export function createAdmissionRepositories(
  transaction: Prisma.TransactionClient,
): AdmissionRepositories {
  return {
    claimProviderEvidence: (input) => claimProviderEvidence(transaction, input),
    createMembership: (input) => createMembership(transaction, input),
    createProviderAssignment: (input) => createProviderAssignment(transaction, input),
    createBootstrapAssignment: (input) => createOrRestoreBootstrapAssignment(transaction, input),
    createHubSession: (input) => createHubSession(transaction, input),
    createOrRestoreMembership: (input) => createOrRestoreMembership(transaction, input),
    createSecurityAudit: (input) => createSecurityAudit(transaction, input),
    recordRepositoryAccess: async (input) => {
      const repositoryIds = await upsertConnectedRepositories(transaction, input.repositories, {
        allowReconnect: false,
      })
      await replaceRepositoryAccessGrants(transaction, {
        createId: input.createId,
        membershipId: input.membershipId,
        observedAt: input.observedAt,
        repositoryIds,
      })
    },
    endProviderAssignment: (input) => endProviderAssignment(transaction, input),
    endOpenHubSessionsForMembership: (membershipId, reason) =>
      endOpenHubSessionsForMembership(transaction, membershipId, reason),
    lockActiveAssignments: (membershipId) =>
      lockActiveMembershipAssignments(transaction, membershipId),
    lockActiveProviderAssignment: (externalIdentityId) =>
      lockActiveProviderAssignment(transaction, externalIdentityId),
    lockAttempt: (id) => lockConsumedAuthorizationAttempt(transaction, id),
    getExternalIdentity: (id) => getExternalIdentity(transaction, id),
    hasDisconnectedRepositories: (repositories) =>
      hasDisconnectedRepositories(transaction, repositories),
    lockGitHubRepositoryAccess: () => lockGitHubRepositoryAccessState(transaction),
    lockMembership: (userId) => lockMembership(transaction, userId),
    lockProvider: (key) => lockSelectedAuthenticationProvider(transaction, key),
    lockRevocation: () => lockSessionRevocationState(transaction),
  }
}
