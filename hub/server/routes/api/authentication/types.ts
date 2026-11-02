import type { Request } from "express"

import type { AuthenticationProofResult } from "../../../domains/authentication/types.ts"

export interface RateLimitDependencies {
  checkRateLimit(operation: "start" | "callback", subjectDigest: string): Promise<boolean>
  writeRateLimitDenial?(): Promise<unknown>
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
  secureCookie: boolean
  complete(input: {
    browserBinding: string
    code: string
    state: string
  }): Promise<{ proof: AuthenticationProofResult }>
  admit(input: {
    proof: AuthenticationProofResult
    sessionDigest: string
    sessionId: string
  }): Promise<{
    expiresAt: Date
    membershipId: string
    role: "administrator"
    sessionId: string
    userId: string
  }>
}

export interface CurrentSessionDependencies {
  secureCookie: boolean
  restore(sessionDigest: string): Promise<{
    membershipId: string
    role: "administrator"
    sessionId: string
    userId: string
  } | null>
}

export interface SignOutDependencies {
  applicationOrigin: string
  secureCookie: boolean
  end(sessionDigest: string): Promise<boolean>
}

export interface AuthenticationRouteDependencies {
  callback: AuthenticationCallbackDependencies
  currentSession: CurrentSessionDependencies
  signIn: StartAuthenticationDependencies
  signOut: SignOutDependencies
  administratorEnrollment: StartAdministratorEnrollmentDependencies
}

export interface AuthenticationRequest extends Request {
  authenticationRateLimitAllowed?: boolean
}
