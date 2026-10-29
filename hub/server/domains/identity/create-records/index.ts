import { createAuthenticationProviderRevision } from "#server/repositories/authentication-providers/create-provider-revision"
import { getCurrentAuthenticationProviderRevision } from "#server/repositories/authentication-providers/get-current-revision"
import { getLatestAuthenticationProviderRevision } from "#server/repositories/authentication-providers/get-latest-revision"
import { getAuthenticationProviderRevision } from "#server/repositories/authentication-providers/get-revision"
import { consumeAuthorizationAttempt } from "#server/repositories/authorization-attempts/consume-attempt"
import { createAuthorizationAttempt } from "#server/repositories/authorization-attempts/create-attempt"
import { getExternalIdentity } from "#server/repositories/external-identities/get-external-identity"
import { getExternalIdentityByDirectoryObjectId } from "#server/repositories/external-identities/get-external-identity-by-directory-object-id"
import { saveExternalIdentity } from "#server/repositories/external-identities/save-external-identity"
import { updateExternalIdentitySubject } from "#server/repositories/external-identities/update-external-identity-subject"
import { advanceGitHubIntegrationGeneration } from "#server/repositories/github-integration-state/advance-generation"
import { hasFreshGitHubAdmission } from "#server/repositories/github-synchronized-access/has-fresh-admission"
import { getGitHubIntegrationState } from "#server/repositories/github-integration-state/get-state"
import { saveGitHubIntegrationCredentials } from "#server/repositories/github-integration-state/save-credentials"
import { advanceSessionGeneration } from "#server/repositories/identity-store-state/advance-session-generation"
import { completeBootstrap } from "#server/repositories/identity-store-state/complete-bootstrap"
import { getBootstrapCompletedAt } from "#server/repositories/identity-store-state/get-bootstrap-completed-at"
import { getIdentityStoreState } from "#server/repositories/identity-store-state/get-state"
import { countActiveAdministrators } from "#server/repositories/installation-memberships/count-active-administrators"
import { getInstallationMembership } from "#server/repositories/installation-memberships/get-membership"
import { getInstallationMembershipById } from "#server/repositories/installation-memberships/get-membership-by-id"
import { getInstallationMemberships } from "#server/repositories/installation-memberships/get-memberships"
import { saveInstallationMembership } from "#server/repositories/installation-memberships/save-membership"
import { consumeMembershipInvitation } from "#server/repositories/membership-invitations/consume-invitation"
import { createMembershipInvitation } from "#server/repositories/membership-invitations/create-invitation"
import { getMembershipInvitation } from "#server/repositories/membership-invitations/get-invitation"
import { getMembershipInvitations } from "#server/repositories/membership-invitations/get-invitations"
import { getUsableMembershipInvitation } from "#server/repositories/membership-invitations/get-usable-invitation"
import { revokeMembershipInvitation } from "#server/repositories/membership-invitations/revoke-invitation"
import { revokeExpiredMembershipInvitations } from "#server/repositories/membership-invitations/revoke-expired-invitations"
import { getSecurityAudits } from "#server/repositories/security-audits/get-audits"
import { saveSecurityAudit } from "#server/repositories/security-audits/save-audit"
import { createSession } from "#server/repositories/sessions/create-session"
import { deleteSession } from "#server/repositories/sessions/delete-session"
import { deleteSessions } from "#server/repositories/sessions/delete-sessions"
import { deleteUserSessions } from "#server/repositories/sessions/delete-user-sessions"
import { getSession } from "#server/repositories/sessions/get-session"
import { getSessionById } from "#server/repositories/sessions/get-session-by-id"
import { invalidateFreshness } from "#server/repositories/sessions/invalidate-freshness"
import { verifySession } from "#server/repositories/sessions/verify-session"
import { createUser } from "#server/repositories/users/create-user"
import { getUser } from "#server/repositories/users/get-user"
import { updateUser } from "#server/repositories/users/update-user"
import type { IdentityRecords } from "#server/domains/identity/create-store/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function createIdentityRecords(database: Prisma.TransactionClient): IdentityRecords {
  return {
    identityStoreState: getIdentityStoreState.bind(null, database),
    bootstrapCompletedAt: getBootstrapCompletedAt.bind(null, database),
    advanceSessionGeneration: advanceSessionGeneration.bind(null, database),
    completeBootstrap: completeBootstrap.bind(null, database),
    githubIntegrationState: getGitHubIntegrationState.bind(null, database),
    saveGitHubIntegrationCredentials: saveGitHubIntegrationCredentials.bind(null, database),
    advanceGitHubIntegrationGeneration: advanceGitHubIntegrationGeneration.bind(null, database),
    hasFreshGitHubAdmission: hasFreshGitHubAdmission.bind(null, database),
    user: getUser.bind(null, database),
    createUser: createUser.bind(null, database),
    updateUser: updateUser.bind(null, database),
    externalIdentity: getExternalIdentity.bind(null, database),
    externalIdentityByDirectoryObjectId: getExternalIdentityByDirectoryObjectId.bind(
      null,
      database,
    ),
    saveExternalIdentity: saveExternalIdentity.bind(null, database),
    updateExternalIdentitySubject: updateExternalIdentitySubject.bind(null, database),
    membership: getInstallationMembership.bind(null, database),
    membershipById: getInstallationMembershipById.bind(null, database),
    memberships: getInstallationMemberships.bind(null, database),
    activeAdministratorCount: countActiveAdministrators.bind(null, database),
    saveMembership: saveInstallationMembership.bind(null, database),
    createInvitation: createMembershipInvitation.bind(null, database),
    invitation: getMembershipInvitation.bind(null, database),
    invitations: getMembershipInvitations.bind(null, database),
    usableInvitation: getUsableMembershipInvitation.bind(null, database),
    consumeInvitation: consumeMembershipInvitation.bind(null, database),
    revokeInvitation: revokeMembershipInvitation.bind(null, database),
    revokeExpiredInvitations: revokeExpiredMembershipInvitations.bind(null, database),
    createAuthenticationProviderRevision: createAuthenticationProviderRevision.bind(null, database),
    currentAuthenticationProviderRevision: getCurrentAuthenticationProviderRevision.bind(
      null,
      database,
    ),
    latestAuthenticationProviderRevision: getLatestAuthenticationProviderRevision.bind(
      null,
      database,
    ),
    authenticationProviderRevision: getAuthenticationProviderRevision.bind(null, database),
    session: getSession.bind(null, database),
    sessionById: getSessionById.bind(null, database),
    createSession: createSession.bind(null, database),
    verifySession: verifySession.bind(null, database),
    invalidateFreshness: invalidateFreshness.bind(null, database),
    deleteSession: deleteSession.bind(null, database),
    deleteSessions: deleteSessions.bind(null, database),
    deleteUserSessions: deleteUserSessions.bind(null, database),
    createAuthorizationAttempt: createAuthorizationAttempt.bind(null, database),
    consumeAuthorizationAttempt: consumeAuthorizationAttempt.bind(null, database),
    audit: saveSecurityAudit.bind(null, database),
    audits: getSecurityAudits.bind(null, database),
  }
}
