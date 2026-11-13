import type { AuthenticationProofResult } from "../../../domains/authentication/types.ts"
import type { SecurityAuditListResult } from "../../../repositories/security-audits/list-security-audits/types.ts"

export interface RateLimitDependencies {
  checkRateLimit(
    operation: "start" | "callback",
    subjectDigest: string,
  ): Promise<{ allowed: boolean; auditFailed: boolean }>
}

export interface StartAuthenticationDependencies extends RateLimitDependencies {
  applicationOrigin: string
  secureCookie: boolean
  start(input?: { switchAccount?: boolean }): Promise<{
    authorizationUrl: string
    browserBinding: string
    expiresAt: Date
  }>
}

export interface StartAdministratorEnrollmentDependencies extends StartAuthenticationDependencies {
  verifyBootstrapSecret(submittedSecret: string): boolean
  writeBootstrapDenial(reason: "invalid_secret"): Promise<unknown>
}

export interface AuthenticationCallbackDependencies extends RateLimitDependencies {
  callbackIssuer?: string
  createGitHubRepositoryDenialNotice?(login: string): { expiresAt: Date; value: string }
  secureCookie: boolean
  complete(input: { browserBinding: string; code: string; state: string }): Promise<{
    purpose: "SIGN_IN" | "ADMIN_ENROLLMENT" | "ADMINISTRATOR_MANAGEMENT"
    sensitiveAuthorizationId?: string
    githubLogin?: string
    proof: AuthenticationProofResult
    providerAssignment?: {
      assignmentSubject: string | null
      issuedAt: Date
      providerRevisionId: string
      role: "MEMBER" | "ADMINISTRATOR" | null
    }
    repositoryAccess?: Array<{
      defaultBranch: string
      githubRepositoryId: number
      nameWithOwner: string
    }>
  }>
  verifyAdministratorAuthorization?(input: {
    authorizationAttemptId: string
    externalIdentityId: string
    providerAssignment?: {
      assignmentSubject: string | null
      issuedAt: Date
      providerRevisionId: string
      role: "MEMBER" | "ADMINISTRATOR" | null
    }
    sessionDigest: string
    sensitiveAuthorizationId: string
  }): Promise<boolean>
  admit(input: {
    proof: AuthenticationProofResult
    providerAssignment?: {
      assignmentSubject: string | null
      issuedAt: Date
      providerRevisionId: string
      role: "MEMBER" | "ADMINISTRATOR" | null
    }
    repositoryAccess?: Array<{
      defaultBranch: string
      githubRepositoryId: number
      nameWithOwner: string
    }>
    sessionDigest: string
    sessionId: string
  }): Promise<{
    expiresAt: Date
  }>
}

export interface CurrentSessionDependencies {
  findGitHubRepositoryAccessDenial?(sessionDigest: string): Promise<{ login: string | null } | null>
  readGitHubRepositoryDenialNotice?(value: string): { login: string } | null
  restore(sessionDigest: string): Promise<{
    membershipId: string
    userId: string
    provider: string
    login: string
    name: string | null
    role: "MEMBER" | "ADMINISTRATOR"
  } | null>
}

export interface SignOutDependencies {
  applicationOrigin: string
  secureCookie: boolean
  end(sessionDigest: string): Promise<boolean>
}

export interface AuthenticationRouteDependencies {
  administrators?: AdministratorRouteDependencies
  currentSession: CurrentSessionDependencies
  entra?: ProviderAuthenticationRouteDependencies
  github?: ProviderAuthenticationRouteDependencies
  local?: ProviderAuthenticationRouteDependencies
  signOut: SignOutDependencies
}

export interface ProviderAuthenticationRouteDependencies {
  administratorAuthorization?: StartAdministratorAuthorizationDependencies
  administratorEnrollment: StartAdministratorEnrollmentDependencies
  callback: AuthenticationCallbackDependencies
  signIn: StartAuthenticationDependencies
}

export interface StartAdministratorAuthorizationDependencies extends RateLimitDependencies {
  applicationOrigin: string
  secureCookie: boolean
  start(input: {
    actorMembershipId: string
    externalIdentityId: string
    hubSessionId: string
    operation: "DESIGNATE_ADMINISTRATORS" | "REVOKE_ADMINISTRATOR"
    targetMembershipIds: string[]
  }): Promise<{
    authorizationId: string
    authorizationUrl: string
    browserBinding: string
    expiresAt: Date
  }>
}

export interface AdministratorRouteDependencies {
  applicationOrigin: string
  cancel(input: { authorizationId: string; hubSessionId: string }): Promise<boolean>
  continue(input: {
    authorizationId: string
    hubSessionId: string
    operation: "DESIGNATE_ADMINISTRATORS" | "REVOKE_ADMINISTRATOR"
    targetMembershipIds: string[]
  }): Promise<unknown>
  findSession(sessionDigest: string): Promise<{
    externalIdentityId: string
    id: string
    membershipId: string
    providerKey: string
  } | null>
  getAuthorization(input: { authorizationId: string; hubSessionId: string }): Promise<unknown>
  list(input: {
    before?: { createdAt: Date; membershipId: string }
    limit?: number
  }): Promise<unknown>
  listSecurityAudits(input: {
    before?: { createdAt: Date; id: string }
    limit?: number
  }): Promise<SecurityAuditListResult>
  search(input: { limit?: number; query: string }): Promise<unknown>
  start: Partial<Record<"entra" | "github" | "local", StartAdministratorAuthorizationDependencies>>
}
