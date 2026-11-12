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
  start(): Promise<{
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
  secureCookie: boolean
  complete(input: { browserBinding: string; code: string; state: string }): Promise<{
    purpose: "SIGN_IN" | "ADMIN_ENROLLMENT" | "ADMINISTRATOR_MANAGEMENT"
    sensitiveAuthorizationId?: string
    proof: AuthenticationProofResult
    providerAssignment?: {
      assignmentSubject: string | null
      issuedAt: Date
      providerRevisionId: string
      role: "MEMBER" | "ADMINISTRATOR" | null
    }
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
  }): Promise<
    | "CONNECT_COPILOT"
    | "DESIGNATE_ADMINISTRATORS"
    | "DISCONNECT_COPILOT"
    | "END_ALL_HUB_SESSIONS"
    | "REVOKE_ADMINISTRATOR"
    | null
  >
  admit(input: {
    proof: AuthenticationProofResult
    providerAssignment?: {
      assignmentSubject: string | null
      issuedAt: Date
      providerRevisionId: string
      role: "MEMBER" | "ADMINISTRATOR" | null
    }
    sessionDigest: string
    sessionId: string
  }): Promise<{
    expiresAt: Date
  }>
}

export interface CurrentSessionDependencies {
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
  copilotConnection?: CopilotConnectionRouteDependencies
  currentSession: CurrentSessionDependencies
  entra?: ProviderAuthenticationRouteDependencies
  github?: ProviderAuthenticationRouteDependencies
  local?: ProviderAuthenticationRouteDependencies
  sessionRevocation?: SessionRevocationRouteDependencies
  signOut: SignOutDependencies
}

export interface CopilotConnectionRouteDependencies {
  applicationOrigin: string
  cancel(input: { authorizationId: string; hubSessionId: string }): Promise<boolean>
  continue(input: {
    authorizationId: string
    hubSessionId: string
    operation: "CONNECT_COPILOT" | "DISCONNECT_COPILOT"
  }): Promise<{ connected: boolean }>
  findSession: AdministratorRouteDependencies["findSession"]
  getAuthorization: AdministratorRouteDependencies["getAuthorization"]
  getState(): Promise<{
    connected: boolean
    connectedAt: Date | null
    connectedBy: { login: string | null; membershipId: string; name: string | null } | null
    generation: bigint
    refusedAt: Date | null
    tokenNeedsCheck: boolean
    verifiedAt: Date | null
  }>
  recordView(actorMembershipId: string): Promise<unknown>
  start: AdministratorRouteDependencies["start"]
  tokenConfigured: boolean
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
    expectedCopilotGeneration?: bigint
    externalIdentityId: string
    hubSessionId: string
    operation:
      | "CONNECT_COPILOT"
      | "DESIGNATE_ADMINISTRATORS"
      | "DISCONNECT_COPILOT"
      | "END_ALL_HUB_SESSIONS"
      | "REVOKE_ADMINISTRATOR"
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
  getAuthorization(input: { authorizationId: string; hubSessionId: string }): Promise<{
    expiresAt: Date
    operation:
      | "CONNECT_COPILOT"
      | "DESIGNATE_ADMINISTRATORS"
      | "DISCONNECT_COPILOT"
      | "END_ALL_HUB_SESSIONS"
      | "REVOKE_ADMINISTRATOR"
    targets: Array<{
      login: string | null
      membershipId: string
      name: string | null
      provider: string | null
    }>
    verifiedAt: Date
  } | null>
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

export interface SessionRevocationRouteDependencies {
  applicationOrigin: string
  cancel(input: { authorizationId: string; hubSessionId: string }): Promise<boolean>
  continue(input: { authorizationId: string; hubSessionId: string }): Promise<{
    cancelledAuthorizationCount: number
    endedSessionCount: number
    revision: number
  }>
  findSession: AdministratorRouteDependencies["findSession"]
  getAuthorization: AdministratorRouteDependencies["getAuthorization"]
  getStatus(): Promise<{
    activeSessionCount: number
    pendingAuthenticationCount: number
    pendingSensitiveAuthorizationCount: number
    revision: number
  } | null>
  secureCookie: boolean
  start: AdministratorRouteDependencies["start"]
}
