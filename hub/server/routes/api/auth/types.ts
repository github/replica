import type { AuthenticationProofResult } from "../../../domains/authentication/types.ts"

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
    proof: AuthenticationProofResult
    providerAssignment?: {
      assignmentSubject: string | null
      providerRevisionId: string
      role: "MEMBER" | "ADMINISTRATOR" | null
    }
  }>
  admit(input: {
    proof: AuthenticationProofResult
    providerAssignment?: {
      assignmentSubject: string | null
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
  restore(sessionDigest: string): Promise<{ role: "MEMBER" | "ADMINISTRATOR" } | null>
}

export interface SignOutDependencies {
  applicationOrigin: string
  secureCookie: boolean
  end(sessionDigest: string): Promise<boolean>
}

export interface AuthenticationRouteDependencies {
  currentSession: CurrentSessionDependencies
  entra?: ProviderAuthenticationRouteDependencies
  github?: ProviderAuthenticationRouteDependencies
  signOut: SignOutDependencies
}

export interface ProviderAuthenticationRouteDependencies {
  administratorEnrollment: StartAdministratorEnrollmentDependencies
  callback: AuthenticationCallbackDependencies
  signIn: StartAuthenticationDependencies
}
