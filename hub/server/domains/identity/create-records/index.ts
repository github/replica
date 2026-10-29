import { createAuthenticationProviderRevision } from "#server/repositories/authentication-providers/create-provider-revision"
import { consumeAuthorizationAttempt } from "#server/repositories/authorization-attempts/consume-attempt"
import { createAuthorizationAttempt } from "#server/repositories/authorization-attempts/create-attempt"
import { getExternalIdentity } from "#server/repositories/external-identities/get-external-identity"
import { saveExternalIdentity } from "#server/repositories/external-identities/save-external-identity"
import { getGitHubIntegrationCredentials } from "#server/repositories/github-integration-credentials/get-credentials"
import { saveGitHubIntegrationCredentials } from "#server/repositories/github-integration-credentials/save-credentials"
import { getInstallationMembership } from "#server/repositories/installation-memberships/get-membership"
import { saveInstallationMembership } from "#server/repositories/installation-memberships/save-membership"
import { getSecurityAudits } from "#server/repositories/security-audits/get-audits"
import { saveSecurityAudit } from "#server/repositories/security-audits/save-audit"
import { createSession } from "#server/repositories/sessions/create-session"
import { deleteSession } from "#server/repositories/sessions/delete-session"
import { deleteSessions } from "#server/repositories/sessions/delete-sessions"
import { getSession } from "#server/repositories/sessions/get-session"
import { getSessionById } from "#server/repositories/sessions/get-session-by-id"
import { invalidateFreshness } from "#server/repositories/sessions/invalidate-freshness"
import { verifySession } from "#server/repositories/sessions/verify-session"
import { createUser } from "#server/repositories/users/create-user"
import { getUser } from "#server/repositories/users/get-user"
import type { IdentityRecords } from "#server/domains/identity/create-store/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function createIdentityRecords(database: Prisma.TransactionClient): IdentityRecords {
  return {
    githubIntegrationCredentials: getGitHubIntegrationCredentials.bind(null, database),
    saveGitHubIntegrationCredentials: saveGitHubIntegrationCredentials.bind(null, database),
    user: getUser.bind(null, database),
    createUser: createUser.bind(null, database),
    externalIdentity: getExternalIdentity.bind(null, database),
    saveExternalIdentity: saveExternalIdentity.bind(null, database),
    membership: getInstallationMembership.bind(null, database),
    saveMembership: saveInstallationMembership.bind(null, database),
    createAuthenticationProviderRevision: createAuthenticationProviderRevision.bind(null, database),
    session: getSession.bind(null, database),
    sessionById: getSessionById.bind(null, database),
    createSession: createSession.bind(null, database),
    verifySession: verifySession.bind(null, database),
    invalidateFreshness: invalidateFreshness.bind(null, database),
    deleteSession: deleteSession.bind(null, database),
    deleteSessions: deleteSessions.bind(null, database),
    createAuthorizationAttempt: createAuthorizationAttempt.bind(null, database),
    consumeAuthorizationAttempt: consumeAuthorizationAttempt.bind(null, database),
    audit: saveSecurityAudit.bind(null, database),
    audits: getSecurityAudits.bind(null, database),
  }
}
