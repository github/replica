import { advanceIdentityGeneration } from "#server/repositories/identity-state/advance-generation"
import { getIdentityState } from "#server/repositories/identity-state/get-state"
import { saveIdentityCredentials } from "#server/repositories/identity-state/save-credentials"
import { consumeOAuthAttempt } from "#server/repositories/oauth-attempts/consume-attempt"
import { createOAuthAttempt } from "#server/repositories/oauth-attempts/create-attempt"
import { getSecurityAudits } from "#server/repositories/security-audits/get-audits"
import { saveSecurityAudit } from "#server/repositories/security-audits/save-audit"
import { createSession } from "#server/repositories/sessions/create-session"
import { deleteSession } from "#server/repositories/sessions/delete-session"
import { deleteSessions } from "#server/repositories/sessions/delete-sessions"
import { getSession } from "#server/repositories/sessions/get-session"
import { getSessionById } from "#server/repositories/sessions/get-session-by-id"
import { invalidateFreshness } from "#server/repositories/sessions/invalidate-freshness"
import { verifySession } from "#server/repositories/sessions/verify-session"
import { enrollAdministrator } from "#server/repositories/users/enroll-administrator"
import { getGitHubUser } from "#server/repositories/users/get-github-user"
import { getUser } from "#server/repositories/users/get-user"
import { saveGitHubUser } from "#server/repositories/users/save-github-user"
import type { IdentityRecords } from "#server/domains/identity/create-store/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function createIdentityRecords(database: Prisma.TransactionClient): IdentityRecords {
  return {
    state: getIdentityState.bind(null, database),
    saveCredentials: saveIdentityCredentials.bind(null, database),
    advanceGeneration: advanceIdentityGeneration.bind(null, database),
    user: getUser.bind(null, database),
    githubUser: getGitHubUser.bind(null, database),
    saveUser: saveGitHubUser.bind(null, database),
    enroll: enrollAdministrator.bind(null, database),
    session: getSession.bind(null, database),
    sessionById: getSessionById.bind(null, database),
    createSession: createSession.bind(null, database),
    verifySession: verifySession.bind(null, database),
    invalidateFreshness: invalidateFreshness.bind(null, database),
    deleteSession: deleteSession.bind(null, database),
    deleteSessions: deleteSessions.bind(null, database),
    createAttempt: createOAuthAttempt.bind(null, database),
    consumeAttempt: consumeOAuthAttempt.bind(null, database),
    audit: saveSecurityAudit.bind(null, database),
    audits: getSecurityAudits.bind(null, database),
  }
}
